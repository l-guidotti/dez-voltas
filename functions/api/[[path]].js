import {handleApi} from '../../server/api.js';
export const onRequest=({request,env})=>handleApi(request,env);
