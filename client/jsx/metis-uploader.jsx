import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import MetisModel from './models/metis-model';
import MetisUIContainer from './components/metis-ui-container';

class MetisUploader{

  constructor(){

    this['model'] = null;
    this['uploadWorker'] = null;

    this.initDataStore();
    this.spawnUploadWorker();
    this.buildUI();
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

  /*
   * Commands from the UI (via Redux).
   * You would normally see Thunk middleware implemented at the reducer for asyc
   * operations. However, since we are using web workers we don't care about 
   * asyc operations. We receive events from the redux store and we dispatch
   * events to the redux store. This way there is only one entry point to UI, 
   * which is through the redux store, and we do not upset the react/redux 
   * paradigm.
   */
  routeAction(action){

    switch(action['type']){

      case 'FILE_SELECTED':

        this.fileSelected(action['data']);
        break;
      case 'FILE_UPLOAD_AUTHORIZED':

        this.queueUploader();
        break;
      default:

        //none
        break;
    }
  }

  /*
   * Preupload sorting and checks of the data before we call the upload worker.
   */
  queueUploader(){

    /*
     * check if there are any active uploads. If not then reset the uploader and 
     * begin a new upload from the top of the queue.
     */

    var state = this['model']['store'].getState();
    var uploads = state['metisState']['fileUploads'];

    var anyActive = false;
    for(var a = 0; a < uploads.length; ++a){

      if(uploads[a]['status'] == 'active'){

        anyActive = true;
        break;
      }
    }

    if(!anyActive){

      this.startUploader(uploads[0]);
    }
  }

  /*
   * Commands to the Upload Worker.
   */
  startUploader(uploadFile){

    var workerMessage = {
      
      command: 'start', 
      file: uploadFile,
      request: PARSE_REQUEST(uploadFile) 
    };
    this['uploadWorker'].postMessage(workerMessage);
  }

  pauseUploader(){

    console.log("test");
  }

  /*
   * Responses from the Upload Worker.
   */
  routeResponse(message){

    switch(message['data']['type']){

      case 'error':

        this['uploadWorker'].onerror(message['data']);
        break;
      case 'active':

        var response = message['data']['response'];
        var action = { type: 'FILE_UPLOAD_ACTIVE', data: response };
        this['model']['store'].dispatch(action);
        break;
      case 'complete':

        var response = message['data']['response'];
        var action = { type: 'FILE_UPLOAD_COMPLETE', data: response };
        this['model']['store'].dispatch(action);
        break;
      default:

        //none
        break;
    }
  }

  /*
   * File selected, now call Magma to get an HMAC Auth Message.
   */
  fileSelected(file){

    var state = this['model']['store'].getState();
    var userInfo = state['metisState']['userInfo'];

    var authRequest = {

      user_email: file['user_email'],
      original_name: file['name'],
      file_size: file['size'], //in bytes
      redis_index: file['redis_index'],
      authorization_token: userInfo['authorization_token'],
    };

    this.requestAuthorization(authRequest);
  }

  /*
   * Call Magma to get approval to make an action on Metis.
   */
  requestAuthorization(authRequest){

    //Serialize the request for POST
    var request = [];
    for(var key in authRequest){

      request.push(key +'='+ authRequest[key]);
    }
    request = request.join('&');

    AJAX({

      url: './magma-end-point', //replace this URL with the Magma End Point
      method: 'POST',
      sendType: 'serial',
      returnType: 'json',
      data: request,
      success: this['authorizationResponse'].bind(this),
      error: this['ajaxError'].bind(this)
    });
  }
  
  /*
   * Route the signed response from Magma to the web worker.
   */
  authorizationResponse(response){

    if(response['success']){

      var action = { type: 'FILE_UPLOAD_AUTHORIZED', data: response };
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

//Initilize the class.
var metisUploader = new MetisUploader();