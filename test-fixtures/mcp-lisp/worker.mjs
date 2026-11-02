import {parentPort} from 'node:worker_threads';
import {handleMessage} from '../../lisp-worker.js';
parentPort.on('message',async data=>{const reply=await handleMessage(data);if(reply)parentPort.postMessage(reply);});
parentPort.postMessage({ready:true});
