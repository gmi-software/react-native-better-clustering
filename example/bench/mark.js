/* global http, HOST, PHASE */
// Maestro script: asks run.mjs to sample the app's memory now, at phase PHASE.
http.post(HOST + '/mark?phase=' + PHASE, { body: '' })
