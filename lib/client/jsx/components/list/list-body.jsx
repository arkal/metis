import * as React from 'react';

import ListEntry from './list-entry';
import ListUpload from './list-upload';
import ListUploadFailed from './list-upload-failed';

export default class ListBody extends React.Component{
  constructor() {
    super();
  }
  
  render() {
    let { fileData, userInfo } = this.props;
    let { fileUploads, fileList, fileFails } = fileData;
    let { permissions } = userInfo;

    return (
      <tbody id='list-body-group'>
        {/* Render the failed uploads. */}
        { (fileFails.length) ? 
            fileFails.map((failedFile)=>{
              let failedUpload = {
                key: 'file-failed-'+failedFile.reactKey,
                failedFile: failedFile,
                callbacks: {
                  recoverUpload: this.props.recoverUpload,
                  removeFailed: this.props.removeFailed,
                }
              };

              return <ListUploadFailed { ...failedUpload } />;
            })
          : '' }
        {/* Render the incomplete uploads. */}
        { (Object.keys(fileUploads).length) ?
            Object.keys(fileUploads).map((fileKey)=>{
              let fileUpload = fileUploads[fileKey];
              let listUpload = {
                key: 'file-upload-'+fileKey,
                reactKey:  fileKey,
                fileUpload,
                permissions,
                callbacks: {
                  initializeUpload: this.props.initializeUpload,
                  queueUpload: this.props.queueUpload,
                  pauseUpload: this.props.pauseUpload,
                  cancelUpload: this.props.cancelUpload,
                  removeFile: this.props.removeFile,
                  clearUpload: this.props.clearUpload,
                  selectProject: this.props.selectProject
                }
              };

              return <ListUpload { ...listUpload } />
            })
          : '' }
        {/* Render the complete uploads. */}
        { (fileList.length) ?
            fileList.map((fileInfo, i)=>{
              let listEntry = {
                key: i,
                fileInfo: fileInfo,
                callbacks: {
                  removeFile: this.props.removeFile
                }
              };

              return <ListEntry { ...listEntry } />
            })
          : '' }
      </tbody>
    );
  }
}
