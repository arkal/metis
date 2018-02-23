/*
 * This class will upload a file as blobs to the Metis upload endpoint.
 */

import SparkMD5 from 'spark-md5';
import { postUploadBlob } from '../api/upload_api';
/*
 * In milliseconds, the amount of time to transfer one blob. This ultimately
 * sets the blob size.
 */
const XTR_TIME = 2000;
const MIN_BLOB_SIZE = Math.pow(2, 10); // in bytes
const MAX_BLOB_SIZE = Math.pow(2, 20);

export default (self) => {
  let dispatch = (action) => self.postMessage(action);

  let error = (message) => dispatch(
    { type: 'WORKER_ERROR', worker: 'upload', message }
  );

  let pause = false;
  let cancel = false;
  let timeouts = 0; // The number of times an upload has timed out.
  let maxTimeouts = 5; // The number of attepts to upload a blob.

  /*
   * Implementation of a Worker specific function.
   * For message passing into and out of the worker.
   */

  const createBlob = (upload) => {
    let { file, current_byte_position, next_blob_size } = upload;

    if (current_byte_position >= file.size) return;

    let [ upload_speed, new_blob_size ] = calcNextBlobSize(next_blob_size);
    let next_byte_position = current_byte_position + next_blob_size;
    let final_byte_position = next_byte_position + new_blob_size;

    dispatch({ type: 'FILE_UPLOAD_SPEED', upload, upload_speed });

    // Set the outer limit for 'next_blob_size' and 'endByte'.
    if (final_byte_position > file.size) {
      final_byte_position = file.size;
      new_blob_size = final_byte_position - next_byte_position;
    }

    // Append the current blob to the request.
    let blob = file.slice(current_byte_position, next_byte_position);

    // Hash the next blob.
    let nextBlob = file.slice(next_byte_position, final_byte_position);

    let fileReader = new FileReader();

    fileReader.onload = (event) => {
      let new_blob_hash = SparkMD5.ArrayBuffer.hash(fileReader.result);

      let request = { upload, blob, new_blob_size, new_blob_hash };

      sendBlob(request);
    }
    fileReader.readAsArrayBuffer(nextBlob);

    /*
     * This 'response' object usually comes as a response from
     * the server, but on a 'start' command we just fake it to
     * kick off the sequence again.
     */
  }

  let blobWindow = 30; // How many blob uploads to average over.
  let uploadTimes = [];

  let addUploadTime = (time) => {
    uploadTimes.push(time);
    uploadTimes = uploadTimes.slice(-blobWindow);
  }

  let sendBlob = (request) => {
    let uploadStart = Math.floor(Date.now());

    postUploadBlob(request)
      .then(new_upload => {
        dispatch({ type: 'FILE_UPLOAD_STATUS', upload: new_upload });
        blobComplete({
          ...request.upload,
          ...new_upload
        });

        // update the upload intervals for calculating speed
        let uploadEnd = Math.floor(Date.now());
        addUploadTime(uploadEnd - uploadStart);
      }).catch(
        (error) => {
          if (error.fetch) blobFailed(request);
          else {
            console.log(error);
            throw error
          }
        }
      );
  }


  self.addEventListener('message', ({data}) => {
    let { upload, command } = data;

    // Check that the incoming data has a valid command.
    switch (command) {
      case 'start':
        createBlob(upload);
        break;
      case 'pause':
        // Set a pause flag.
        pauseUploader();
        break;
      case 'cancel':
        // Set a cancel flag.
        cancelUploader();
        break;
      default:
        error('Invalid command');
        break;
    }
  });

  /*
   * Calcuates the next blob size based upon upload speed. Also sets the last
   * calculated upload speed on the request.
   */

  let calcNextBlobSize = (current_blob_size) => {
    if (!uploadTimes.length) return [ null, MIN_BLOB_SIZE ];

    let avgTime = uploadTimes.reduce((sum, time)=>(sum + (time/uploadTimes.length)), 0)

    let nextBlobSize = Math.max(
      MIN_BLOB_SIZE,
      Math.min(
        MAX_BLOB_SIZE,
        Math.floor(current_blob_size * (XTR_TIME / avgTime * 0.9))
      )
    );

    /*
     * Make a rough calculation of the upload speed in kilobits per second.
     * This is just for the UI.
     */
    let uploadSpeed = (current_blob_size * 8) / (avgTime / 1000);

    return [ uploadSpeed, nextBlobSize ];
  };

  let blobComplete = (new_upload) => {
    switch(new_upload.status) {
      case 'incomplete':
        createBlob(new_upload);
        break;
      case 'paused':
        uploader.pause = false;
        dispatch({ type: 'FILE_UPLOAD_PAUSED', response });
        break;
      case 'cancelled':
        uploader.cancel = false;
        dispatch({ type: 'FILE_UPLOAD_CANCELLED', response });
        break;
      case 'complete':
        // Send update message back.
        dispatch({ type: 'FILE_UPLOAD_COMPLETE', response });
        break;
      default:
        // None
        break;
    }
  }

  let blobFailed = (request) => {
    ++timeouts;
    if(timeouts == maxTimeouts) {
      // Reset the uploader.
      pause = false;
      cancel = false;
      timeouts = 0;

      dispatch({ type: 'FILE_UPLOAD_TIMEOUT', upload });
    }
    else {
      sendBlob(request);
    }
  }
}
