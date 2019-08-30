/*
 * This class will upload a file as blobs to the Metis upload endpoint.
 */

import SparkMD5 from 'spark-md5';
import { postAuthorizeUpload, postUploadStart, postUploadBlob, postUploadCancel } from '../api/upload_api';
import { setupWorker } from './worker';

const XTR_TIME = 2000; // blob transfer time in ms, determines blob size.
const BLOB_WINDOW = 30; // How many blob uploads to average over.
const MIN_BLOB_SIZE = Math.pow(2, 10); // in bytes
const MAX_BLOB_SIZE = Math.pow(2, 22);
const INITIAL_BLOB_SIZE = Math.pow(2, 10);

export default (self) => {
  let uploader = setupWorker(self, {
    authorize: ({base_url, project_name, bucket_name, file, file_name}) => {
      uploader.authorizeUpload(base_url, project_name, bucket_name, file, file_name);
    },
    start: ({upload}) => {
      uploader.startUpload(upload);
    },
    continue: ({upload}) => {
      uploader.createNextBlob(upload);
    },
    cancel: ({upload}) => {
      uploader.cancelUpload(upload);
    }
  });

  Object.assign(uploader, {
    reset: () => {
      uploader.timeouts = 0; // The number of times an upload has timed out.
      uploader.maxTimeouts = 5; // The number of attepts to upload a blob.
      uploader.uploadSpeeds = [];
    },

    status: (upload, status) => uploader.dispatch(
      { type: 'UPLOAD_STATUS', upload, status }
    ),
    pause: (upload) => uploader.status(upload, 'paused'),
    active: (upload) => uploader.status(upload, 'active'),
    complete: (upload) => uploader.status(upload, 'complete'),

    remove: (upload) => uploader.dispatch({ type: 'REMOVE_UPLOAD', upload }),

    addUploadSpeed: (uploadStart, upload) => {
      let { next_blob_size } = upload;
      let time = Date.now() - uploadStart;
      uploader.uploadSpeeds.push(next_blob_size / time);
      uploader.uploadSpeeds = uploader.uploadSpeeds.slice(-BLOB_WINDOW);
    },

    // Calcuates the next blob size based upon upload speed.
    setSpeed: (upload) => {
      let { next_blob_size } = upload;
      let { uploadSpeeds } = uploader;
      if (!uploadSpeeds.length) {
        uploader.avgSpeed = MIN_BLOB_SIZE / XTR_TIME;
        return;
      }

      uploader.avgSpeed = uploadSpeeds.reduce((sum,t)=>sum+t, 0) / uploadSpeeds.length;

      // rough calculation of the upload speed in kbps for the UI
      let upload_speed = uploader.avgSpeed * 8 * 1000;

      uploader.dispatch({ type: 'UPLOAD_SPEED', upload, upload_speed });
    },

    timeout: () => {
      ++uploader.timeouts;
      if (uploader.timeouts == uploader.maxTimeouts) {
        uploader.reset();
        uploader.dispatch({ type: 'UPLOAD_TIMEOUT', upload });
        return false;
      }
      return true;
    },

    authorizeUpload: (base_url, project_name, bucket_name, file, file_name) => {
      postAuthorizeUpload(base_url, project_name, bucket_name, file_name)
        .then(({url}) => {
          uploader.dispatch({ type: 'UPLOAD_AUTHORIZED', file, file_name, url })
        })
        .catch(
          () => alert('The upload could not be authorized.')
        )
    },

    startUpload: (upload) => {
      let { file, file_size, file_name, url } = upload;

      // Hash the next blob
      uploader.nextBlob = file.slice(0, INITIAL_BLOB_SIZE);

      uploader.hashBlob().then(next_blob_hash => {
        let request = {
          file_size,
          next_blob_size: INITIAL_BLOB_SIZE,
          next_blob_hash
        };

        postUploadStart(url, request)
          .then(upload => {
            // we may need to slice a new blob
            if (upload.current_byte_position) {
              uploader.nextBlob = file.slice(
                upload.current_byte_position,
                upload.current_byte_position + upload.next_blob_size
              );
            }
            // this will set the upload status correctly in the upload reducer
            uploader.active(upload);

            // now we simply broadcast a completion status for our file:
            uploader.dispatch({ type: 'UPLOAD_STARTED', file_name });
          })
          .catch(
            () => alert('The upload could not be started.')
          )
      });
    },

    hashBlob: () => {
      return new Promise((resolve, reject) => {
        let fileReader = new FileReader();

        fileReader.onload = (event) => {
          let hash = SparkMD5.ArrayBuffer.hash(fileReader.result);

          resolve(hash);
        }

        fileReader.readAsArrayBuffer(uploader.nextBlob);
      });
    },

    cancelUpload: (upload) => {
      let { status, url, project_name, file_name } = upload;

      if (status == 'complete') {
        uploader.remove(upload);
        return;
      }

      postUploadCancel(url, { project_name, file_name })
        .then(() => uploader.remove(upload))
        .catch(
          (error) => alert('The upload could not be canceled.')
        );
    },

    createNextBlob: (upload) => {
      let { file, current_byte_position, next_blob_size } = upload;

      console.log("Resuming from");
      console.log(upload);

      // after this, we know we have more bytes to send
      if (current_byte_position >= file.size) return;

      // report the average upload speed, if any
      uploader.setSpeed(upload);

      // we have already sent up to current_byte_position
      // we will send up to next_byte_position
      let next_byte_position = current_byte_position + next_blob_size;

      // we must also send the hash of the next blob,
      // so we must compute its size, between next_byte_position (the end
      // of this blob) and final_byte_position (the end of the next blob)
      let new_blob_size = Math.min(
          Math.max(
            // we want at least the MIN_BLOB_SIZE
            MIN_BLOB_SIZE,
            // but optimistically, based on the average speed
            Math.floor(XTR_TIME * uploader.avgSpeed)
          ),
          // but we'll stop at most at here
          MAX_BLOB_SIZE,
          // in fact we should stop when we hit the end of the file
          file.size - next_byte_position
      );

      let final_byte_position = next_byte_position + new_blob_size;

      // Get the two blobs
      let blob_data = uploader.nextBlob;
      uploader.nextBlob = file.slice(next_byte_position, final_byte_position);

      // Hash the next blob.
      uploader.hashBlob().then( new_blob_hash => {
        // Finally, send the request
        let request = {
          action: 'blob',
          blob_data,
          next_blob_size: new_blob_size,
          next_blob_hash: new_blob_hash
        };
        uploader.sendBlob(upload, request);
      });
    },

    // make a new blob based on the current position in the file
    sendBlob: (upload, request) => {
      let uploadStart = Date.now();
      let { url } = upload;

      postUploadBlob(url, request)
        .then(new_upload => {
          uploader.addUploadSpeed(uploadStart, upload);
          uploader.completeBlob({
            ...upload,
            ...new_upload
          });

        }).catch(
          (error) => {
            if (error.fetch) uploader.failedBlob(upload, request);
            else {
              console.log(error);
              throw error
            }
          }
        );
    },

    failedBlob: (upload, request) => {
      if (!uploader.timeout()) uploader.sendBlob(upload, request);
    },

    completeBlob: (upload) => {
      let { current_byte_position, file_size } = upload;
      if (current_byte_position < file_size) {
        // update the status
        uploader.status(upload);

        // broadcast that we have finished uploading this blob
        uploader.dispatch({ type: 'UPLOAD_BLOB_COMPLETED', file_name: upload.file_name })
      }
      else {
        // update the status
        uploader.complete(upload);

        // broadcast that we have finished uploading the file
        uploader.dispatch({ type: 'UPLOAD_FILE_COMPLETED', upload })
      }

      //uploader.createNextBlob(upload);
    }

  });

  uploader.reset();

};
