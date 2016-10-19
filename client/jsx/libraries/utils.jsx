/*
 * Global Variables
 */
var BLOB_SIZE = 100000; // in bytes

/*
 * These are the items that are passed between the server and client.
 */
var STATUS_ITEMS = {

  directory: String,
  expires: Number,
  signing_algorithm: String,
  hashing_algorithm: String,
  start_timestamp: Number,
  authorization_token: String,
  original_name: String,    
  file_name: String,
  file_size: Number,
  user_email: String,
  user_id: Number,
  group_id: Number,
  redis_index: String,

  signature: String,
  
  current_blob_size: Number,
  current_byte_position: Number,
  next_blob_hash: String,
  next_blob_size: Number
};

/* 
 * Generates a psudo random key for React components and data element sorting.
 * DO NOT USE FOR SECURITY!
 */
var GENERATE_RAND_KEY = function(){

  var randKey = '';
  for(var a = 0; a < 4; ++a){

    randKey += (Math.random() * 0xFFFFFF << 0).toString(16);
  }

  return randKey;
}

/*
 * Change a timestamp in to a human readable format.
 */
var PARSE_TIMESTAMP = function(timestamp){

  return timestamp;
}

/*
 * Change an integer of bytes into a human readable format.  
 */
var PARSE_BYTES = function(bytes){

  return bytes;
}

/*
 * Data from the controller to the worker cannot be passed through messaging
 * while attached to the File Object (the file request/status data is stored on 
 * the file object in redux). We need to externalize the request/status data
 * from the File Object and pass it over 'worker messaging' as it's own 
 * object/hash.
 */
var PARSE_REQUEST = function(file){

  var request = {};

  for(var key in STATUS_ITEMS){

    if(key in file){

      request[key] = file[key];
    }
  }

  return request;
}

/*
 * Verification of types and structures of the server responses. This will also
 * transform any strings that are supposed to be integers. 
 * 
 * This function needs to be simplified.
 */

var NORMILIZE_RESPONSE = function(response){

  if('success' in response){

    var success = response['success'];
    if((success == 'true') || (success == 'True') || (success == true)){

      response['success'] == true;
    }
    else if((success == 'false') || (success == 'False') || (success == false)){

      response['success'] == false;
    }
    else{

      return false;
    }
  }

  return response;
}

var TRANSFORM_RESPONSE = function(response){

  var error = false;

  if('request' in response){

    var type = Object.prototype.toString.call(response['request']);
    if(type == '[object String]'){

      response['request'] = JSON.parse(response['request']);
    }
  }

  if('byte_count' in response){
    
    response['byte_count'] = parseInt(response['byte_count']);
    if(isNaN(response['byte_count'])) error = true;
  }

  if('signature' in response){

    response['signature'] = String(response['signature']);
  }
  
  if('status' in response){

    response['status'] = String(response['status']);
  }

  for(var key in response['request']){

    if(key in STATUS_ITEMS){

      switch(STATUS_ITEMS[key]){

        case String:

          response['request'][key] = String(response['request'][key]);
          break;
        case Number:
          
          response['request'][key] = parseInt(response['request'][key]);
          if(isNaN(response['request'][key])) error = true;
          break;
        default:

          //none
          break;
      }
    }
  }

  return (error) ? error : response;
}

/*
 * Barebones XHR/AJAX wrapper
 * Works like the JQuery AJAX function, but without JQuery
 */
var AJAX = function(config){

  var url = config.url;
  var method = config.method;
  var sendType = config.sendType;
  var returnType = config.returnType;
  var success = config.success;
  var error = config.error;
  var data = (config.data === undefined) ? "" : config.data;

  var xhr = new XMLHttpRequest();
  
  /*
   * Response Section
   */
  xhr.onreadystatechange = function(){

    switch(xhr.readyState){

      case 0:

        //none
        break;
      case 1:

        //connection opened
        break;
      case 2:

        //headers received
        var type = xhr.getResponseHeader('Content-Type');
        break;
      case 3:

        //loading
        break;
      case 4:

        if(xhr.status === 200){

          switch(returnType.toLowerCase()){

            case 'json':

              success(JSON.parse(xhr.responseText));
              break;
            case 'html':

              success(elem);
              break;  
            default:

              success(xhr.responseText);
              break;
          }
        }
        else{

          error(xhr, config, 'error');
        }
        break;
      default:
        break;
    }
  };
  
  /*
   * Execution/Call Section
   */
  xhr.open(method, url, true);

  switch(method.toLowerCase()){

    case 'post':

      /*
       * If we are using a FormData object then the header is already 
       * set appropriately
       */
      if(sendType.toLowerCase() != 'file'){

        var headerType = 'application/x-www-form-urlencoded';
        xhr.setRequestHeader('Content-type', headerType);
      }
      xhr.send(data);
      break;
    case 'get':

      xhr.send();
      break;
    default:

      error(xhr, config, 'Unknown HTTP Method : "'+ method.toLowerCase() +'"');
      break;
  }
}

/*
 * Dump a blob onto the console.
 */
var HEX_DUMP = function(blob, fromByte){

  var topLine = ['       00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F'];
  var underline = '      ';
  for(var a = 0; a < 48; ++a){

    underline += '_';
  }

  var fileReader = new FileReader();

  fileReader.onload = function(progressEvent){

    var arrayBufferNew = this.result;
    var uint8Array = new Uint8Array(arrayBufferNew);

    var hexCount = 0;
    var hexLine = '';
    var hexRows = [];

    for(var b = 0; b < (fromByte%16); ++b){

      hexLine += '   ';
      ++hexCount;
    }

    for(var b = 0; b < uint8Array.length; ++b){

      var hexChar = uint8Array[b].toString(16);
      if(hexChar.length === 1) hexChar = '0'+ hexChar;
      hexLine += hexChar +' ';
      ++hexCount;

      if(hexCount%16 === 0){

        hexRows.push(hexLine);
        hexLine = '';
        hexCount = 0;
      }
    }

    console.log();
    console.log(topLine.join(' '));
    console.log(underline);

    var rowOffset = fromByte - (fromByte%16);

    for(var row in hexRows){

      var offset = (row*16)+rowOffset;
      var lineNum = ('000' + offset.toString(16)).slice(-4);
      console.log(lineNum +' | '+ hexRows[row]);
    }
  }

  fileReader.readAsArrayBuffer(blob);
}