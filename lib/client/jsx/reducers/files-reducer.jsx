// a random id for the upload
const filekey = () => (Math.random().toString(36) + '0'.repeat(10)).substring(2,12);

// helper to create a new file entry
const file = (file) => ({
  file,
  fileName: file.name,
  currentBytePosition: 0,
  status: 'unauthorized',
  key: filekey()
})

const uploads = (old_uploads, action) => {
  if (!old_uploads) old_uploads = {}

  switch(action.type) {
    case 'FILE_SELECTED':
      // Copy the selected file data to 'fileUploads' object.
      let new_file = file(action.file);
      return {
        ...old_uploads,
        [new_file.key]: new_file
      };
    case 'FILE_UPLOAD_SELECT_PROJECT':
      let { upload, permission: { projectName, role } } = action;
      return {
        ...old_uploads,
        [upload.key]: {
          ...old_uploads[upload.key],
          projectName, role
        }
      };
    case 'FILE_UPLOAD_AUTHORIZED':
      // Append the HMAC url and set the server current byte to 0.
      return {
        ...old_uploads,
        [action.key]: {
          ...old_uploads[action.key],
          status: 'authorized',
          uploadURL: action.url,
          currentBytePosition: 0
        }
      };
    default:
      return old_uploads;
  }
};

const files = (state, action) => {
  if (!state) state = {
    fileList: [],
    fileUploads: {},
    fileFails: []
  } 

  switch(action.type) {
    case 'FILE_UPLOAD_AUTHORIZED':
    case 'FILE_UPLOAD_SELECT_PROJECT':
    case 'FILE_SELECTED':
      return {
        ...state,
        fileUploads: uploads(state.fileUploads,action)
      };

    case 'FILE_UPLOAD_RECOVERED':
      setResponseAndIndex(action, fileFails);
      if(index == null) break;

      // Append all of the request items to the local file object.
      fileFails[index] = Object.assign(fileFails[index], response);
      fileFails[index]=Object.assign(action.uploadFile,fileFails[index]);
      fileUploads.push(fileFails[index]);
      fileFails.splice(index, 1);
      break;

    case 'FILE_INITIALIZED':
    case 'FILE_UPLOAD_ACTIVE':
    case 'FILE_UPLOAD_PAUSED':
      setResponseAndIndex(action, fileUploads);
      if(index == null) break;

      // Append all of the request items to the local file object.
      fileUploads[index] = Object.assign(fileUploads[index], response);
      break;

    case 'FILE_UPLOAD_COMPLETE':
      setResponseAndIndex(action, fileUploads);
      if(index == null) break;

      /*
       * Move the completed upload metadata from the 'uploads' array to the 
       * 'list' array.
       */
      fileList.push(Object.assign(fileUploads[index], response));
      fileUploads.splice(index, 1);
      break;

    case 'FILE_UPLOAD_CANCELLED':
      setResponseAndIndex(action, fileUploads);
      if(index == null) break;

      // Remove the cancelled upload.
      fileUploads.splice(index, 1);
      break;

    case 'FILE_REMOVED':
      response = camelCaseIt(action.response.request);

      // Remove the deleted item from fileUploads.
      index = getMatchingUploadIndex(fileUploads, response);
      if(index != null) fileUploads.splice(index, 1);

      // Remove the deleted item from fileList.
      index = getMatchingUploadIndex(fileList, response);
      if(index != null) fileList.splice(index, 1);

      // Remove the deleted item from fileFails.
      index = getMatchingUploadIndex(fileFails, response);
      if(index != null) fileFails.splice(index, 1);
      break;

    case 'CLEAR_UPLOAD':
      for(var a = 0; a < fileUploads.length; ++a){
        if(action.fileMetadata.reactKey == fileUploads[a].reactKey){
          fileUploads.splice(a, 1);
          break;
        }
      }
      break;

    case 'FILE_METADATA_RECEIVED':
      for(var a = 0; a < action.fileList.length; ++a){
        action.fileList[a] = camelCaseIt(action.fileList[a]);
        action.fileList[a].reactKey = GENERATE_RAND_KEY();

        if(!action.fileList[a].hasOwnProperty('finishUpload')){
          fileData.fileFails.push(action.fileList[a]);
        }
        else{
          fileData.fileList.push(action.fileList[a]);
        }
      }
      break;

    case 'QUEUE_UPLOAD':
      for(var a = 0; a < fileUploads.length; ++a){
        // Remove any 'queued' status
        if(fileUploads[a].status == 'queued'){
          if(fileUploads[a].currentBytePosition == 0){
            fileUploads[a].status = 'initialized';
          }
          else{
            fileUploads[a].status = 'paused';
          }
        }

        // Apply a 'queued' status to a matching file upload.
        if(fileUploads[a].reactKey == action.reactKey){
          fileUploads[a].status = 'queued';
        }
      }
      break;

    default:
      return state;
      break;
  }
};

export default files;

