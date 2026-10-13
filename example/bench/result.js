/* global http, HOST, maestro */
// Maestro script: sends the JSON the app showed in `bench-result` to run.mjs.
http.post(HOST + '/result', { body: maestro.copiedText })
