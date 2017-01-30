import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import JanusLogger from './janus-logger';
import KeyboardShortcuts from './keyboard-shortcuts';
import MetisModel from './models/metis-model';
import MetisUIContainer from './components/metis-ui-container';

class MetisUploader{

  constructor(){

    this['model'] = null;
    this['uploadWorker'] = null;
    this['keyboardShortcuts'] = new KeyboardShortcuts();
    this['janusLogger'] = new JanusLogger();

    this.initDataStore();
    this.spawnUploadWorker();
    this.buildUI();

    /*
     * We pass in the store since we bind events to it. The AJAX callbacks will
     * be dispatched using the store.
     */
    this['janusLogger']['model']['store'] = this['model']['store'];
    this['janusLogger'].checkLog();
  }

  initDataStore(){

    this['model'] = new MetisModel();

    // Event hooks from the UI to the Controller
    this['model']['store'].subscribe(()=>{ 

      var lastAction = this['model']['store'].getState()['lastAction'];
      this.routeAction(lastAction);
    });
  }

  /*
   * Spawn a worker thread for the uploads.
   */
  spawnUploadWorker(){

    this['uploadWorker'] = new Worker('./js/workers/uploader.js');
    this['uploadWorker']['onmessage'] = (message)=>{
      
      this.routeResponse(message);
    };
    
    this['uploadWorker']['onerror'] = (message)=>{

      console.log(message);
    };
  }

  buildUI(){

    ReactDOM.render(

      <Provider store={ this['model']['store'] }>

        <MetisUIContainer />
      </Provider>,
      document.getElementById('ui-group')
    );
  }

  retrieveFiles(){

    var state = this['model']['store'].getState();
    var userInfo = state['userInfo'];
    if(state['userInfo']['loginStatus'] && !state['userInfo']['loginError']){

      // Request authorization to upload the file.
      AJAX({

        'url': '/retrieve-files',
        'method': 'POST',
        'sendType': 'serial',
        'returnType': 'json',
        'data': 'authorization_token='+ userInfo['authToken'],
        'success': this['retrieveFilesResponse'].bind(this),
        'error': this['ajaxError'].bind(this)
      });
    }
  }

  retrieveFilesResponse(response){

    if(response['success']){

      var action = { 

        type: 'FILE_METADATA_RECEIVED', 
        fileList: response['file_list'] 
      };

      this['model']['store'].dispatch(action);
    }
    else{

      console.log('There was an error.');
    }
  }

  /*
   * Commands from the UI (via Redux).
   * You would normally see Thunk middleware implemented at the reducer for asyc
   * operations. However, since we are using web workers we don't care about 
   * asyc operations. We receive events from the redux store and we dispatch
   * events to the redux store. This way there is only one entry point to UI, 
   * which is through the redux store, and we do not upset the react/redux 
   * paradigm. Also if there are duplicate actions between here and a reducer.
   * the action in the reducer will run first.
   */
  routeAction(action){

    switch(action['type']){

      case 'AUTHORIZE_FILE':

        if(!this.checkAuthData(action['uploadFile'])){

          alert('The data to upload is not complete.');
          return;
        }
        this.requestAuthorization(action['uploadFile']);
        break;
      case 'FILE_UPLOAD_AUTHORIZED':

        this.initializeFile(action['authResponse']);
        break;
      case 'QUEUE_UPLOAD':

        this.startUpload();
        break;
      case 'PAUSE_UPLOAD':

        this.pauseUpload();
        break;
      case 'CANCEL_UPLOAD':

        this.cancelUpload(action['fileMetadata']);
        break;
      case 'REMOVE_FILE':

        this.removeFile(action['fileMetadata']);
        break;
      case 'RECOVER_UPLOAD':

        this.recoverUpload(action['uploadFile'], action['fileMetadata']);
        break;
      case 'LOG_IN':

        var email = action['data']['email'];
        var password = action['data']['pass'];
        this['janusLogger'].logIn(email, password);
        break;
      case 'LOGGED_IN':

        this.retrieveFiles();
        break;
      case 'LOG_OUT':

        var state = this['model']['store'].getState();
        var email = state['userInfo']['userEmail'];
        this['janusLogger'].logOut(email, COOKIES.getItem(TOKEN_NAME));
        break;
      case 'LOGGED_OUT':

        window.location = '/';
        break;
      default:

        //none
        break;
    }
  }

  /*
   * Responses from the Upload Worker.
   */
  routeResponse(message){

    switch(message['data']['type']){

      case 'initialized':

        var action = {

          'type': 'FILE_INITIALIZED',
          'initResponse': message['data']['response']
        };

        this['model']['store'].dispatch(action);
        break;
      case 'error':

        //this['uploadWorker'].onerror(message['data']);
        break;
      case 'active':

        var response = message['data']['response'];
        var action = { 

          'type': 'FILE_UPLOAD_ACTIVE', 
          'uploadResponse': response 
        };

        this['model']['store'].dispatch(action);
        break;

      case 'paused':

        var response = message['data']['response'];
        var action = { 

          'type': 'FILE_UPLOAD_PAUSED', 
          'pauseResponse': response 
        };

        this['model']['store'].dispatch(action);

        // Check the queue for another upload.
        this.startUpload();
        break;
      case 'complete':

        var response = message['data']['response'];
        var action = { 

          'type': 'FILE_UPLOAD_COMPLETE',
          'uploadResponse': response
        };

        this['model']['store'].dispatch(action);
        break;
      default:

        // none
        break;
    }
  }

  /*
   * This is stubbed out and needs to be finished
   */
  // Make sure all of the items required for authentication are present.
  checkAuthData(fileUpload){

    return true;
  }

  /*
   * Call to get approval to make an action on Metis.
   */
  requestAuthorization(fileUpload){

    var state = this['model']['store'].getState();
    var userInfo = state['userInfo'];

    // Normailize the data for Ruby.
    var authRequest = {

      'user_email': userInfo['userEmail'],
      'user_id': userInfo['userId'],
      'original_name': fileUpload['name'],
      'file_name': fileUpload['fileName'],
      'file_size': fileUpload['size'], //in bytes
      'redis_index': fileUpload['redisIndex'],
      'authorization_token': userInfo['authToken'],
      'project_name': fileUpload['projectName'],
      'project_id': fileUpload['projectId'],
      'group_id': fileUpload['groupId'],
      'role': fileUpload['role'],
    };

    // Serialize the request for POST.
    var request = [];
    for(var key in authRequest){

      request.push(key +'='+ authRequest[key]);
    }

    // Request authorization to upload the file.
    AJAX({

      'url': '/upload-authorize',
      'method': 'POST',
      'sendType': 'serial',
      'returnType': 'json',
      'data': request.join('&'),
      'success': this['authorizationResponse'].bind(this),
      'error': this['ajaxError'].bind(this)
    });
  }
  
  /*
   * Route the signed response from Magma to the web worker.
   */
  authorizationResponse(response){

    if(response['success']){

      var action = {

        'type': 'FILE_UPLOAD_AUTHORIZED',
        'authResponse': response
      };

      this['model']['store'].dispatch(action);
    }
    else{

      console.log('There was an error.');
    }
  }

  initializeFile(authResponse){

    var uploadFile = this.getUploadFile(authResponse);
    if(uploadFile == null) return;

    var initWorker = new Worker('./js/workers/uploader.js');
    initWorker['onmessage'] = (message)=>{
      
      this.routeResponse(message);
    };
    
    initWorker['onerror'] = (message)=>{

      console.log(message);
    };

    var request = PARSE_REQUEST(uploadFile);
    var state = this['model']['store'].getState();
    var authToken = state['userInfo']['authToken'];
    request['authorizationToken'] = authToken;

    var workerMessage = {

      'command': 'initialize', 
      'file': uploadFile,
      'request': request
    };

    initWorker.postMessage(workerMessage);
  }

  /*
   * Based upon the redisIndex from the auth response we can extract the actual
   * file object from the redux store.
   */
  getUploadFile(authResponse){

    var request = authResponse['request'];
    var state = this['model']['store'].getState();
    var fileUploads = state['fileData']['fileUploads'];
    var uploadFile = null;
    for(var a = 0; a < fileUploads['length']; ++a){

      if(fileUploads[a]['redisIndex'] == request['redisIndex']){

        uploadFile = fileUploads[a];
        break;
      }
    }

    return uploadFile;
  }

  /*
   * For details on the upload/start/pause cycle please refer to the REAME.md
   * file in the 'workers' folder.
   */
  startUpload(){

    var state = this['model']['store'].getState();
    var fileUploads = state['fileData']['fileUploads'];
    var uploadFile = null;

    for(var a = 0; a < fileUploads['length']; ++a){

      if(fileUploads[a]['status'] == 'queued'){

        uploadFile = fileUploads[a];
      }

      /*
       * If there is an file upload that is active we bail out here and run the
       * pause cycle.
       */
      if(fileUploads[a]['status'] == 'active'){

        this.pauseUpload();
        return;
      }
    }

    if(uploadFile == null) return;

    var request = PARSE_REQUEST(uploadFile);
    var authToken = state['userInfo']['authToken'];
    request['authorizationToken'] = authToken;

    var workerMessage = {

      'command': 'start', 
      'file': uploadFile,
      'request': request
    };

    this['uploadWorker'].postMessage(workerMessage);
  }

  pauseUpload(){

    var workerMessage = { 'command': 'pause' };
    this['uploadWorker'].postMessage(workerMessage);
  }

  recoverUpload(uploadFile, fileMetadata){

    // compare file name
    // compare file size
    // extract blob from upload file
    // hash the blob
    // compare the hash
    console.log(fileMetadata);
  }

  removeFile(fileMetadata){

    var delMesg = 'Are you sure you want to delete this file?'
    if(!confirm(delMesg)) return;

    // Serialize the request for POST.
    var request = [];
    for(var key in fileMetadata){

      request.push(SNAKE_CASE_IT(key) +'='+ fileMetadata[key]);
    }

    var state = this['model']['store'].getState();
    request.push('authorization_token='+ state['userInfo']['authToken']);
    request.push('signing_algorithm=MD5');

    // Request authorization to upload the file.
    AJAX({

      'url': '/file-remove',
      'method': 'POST',
      'sendType': 'serial',
      'returnType': 'json',
      'data': request.join('&'),
      'success': this['removeFileResponse'].bind(this),
      'error': this['ajaxError'].bind(this)
    });
  }

  removeFileResponse(response){

    if(response['success']){

      var action = {

        'type': 'FILE_REMOVED',
        'oldMetadata': response['old_metadata']
      };

      this['model']['store'].dispatch(action);
    }
    else{

      console.log('There was an error.');
    }
  }

  ajaxError(xhr, config, error){

    console.log(xhr, config, error);
  }
}

// Initilize the class.
var metisUploader = new MetisUploader();