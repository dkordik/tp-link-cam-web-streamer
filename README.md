# tp-link-cam-web-streamer

Re-streaming a TP-Link camera's HTTPS H264 video stream into a browser-friendly LL-HLS (low-latency HLS) format using `ffmpeg`.

## Usage

### First time setup

- Ensure Node.js is installed

- Ensure `ffmpeg` is installed on your system (`e.g. brew install ffmpeg`)

- Duplicate [secrets.example.js](./secrets.example.js) as `secrets.js`, and fill it out with your camera IP and credentials

- Run `npm install`

### Run

- Run `node server.js` to start a server that listens at `http://localhost:3313/stream` and produces a stream viewable directly in a browser, or embeddable into a client implementation

- There is also an example client implementation at `index.html`. You can test it out by running an HTTP server in that directory (e.g. with [http-server](https://www.npmjs.com/package/http-server))


## Background

### Credits

- The camera request is based on research done by Geistless here: https://medium.com/@hu3vjeen/reverse-engineering-tp-link-kc100-bac4641bf1cd

- The LL-HLS implementation was created in collaboration with ChatGPT.

### Design

HLS was chosen because it is a browser-friendly format that doesn't require a lot of moving parts in its implementation. The processing and re-streaming code is entirely contained within [server.js](/server.js).

My ffmpeg configuration here prioritizes low latency delivery over stream reliability, as this use case is a security camera.