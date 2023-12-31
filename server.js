const http = require("node:http");
const http2 = require("node:http2");
const Koa = require("koa");
const cors = require("@koa/cors");
const route = require("koa-route");

const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

const SECRETS = require("./secrets");
const PORT = "3313";

const app = new Koa();
app.use(cors());

let readyToStream = false;

const outputFilename = "output.m3u8";
const outputPath = path.join(__dirname, outputFilename);

const inputUrl =
  `https://${encodeURIComponent(SECRETS.username)}:${SECRETS.password}@${
    SECRETS.ip
  }:19443/` + `https/stream/mixed?video=h264&audio=g711&resolution=hd`;

console.log("[startup] connecting to source and beginning ffmpeg pipeline");
ffmpeg(inputUrl)
  .inputFormat("h264")
  .videoCodec("libx264")
  .addOption("-an") // No audio
  .addOption("-preset ultrafast")
  .addOption("-strict", "experimental")
  .addOption("-hls_time", "2") // N-second segment duration
  .addOption("-hls_list_size", "2") // Keep only N segments in the playlist
  .addOption("-hls_flags", "split_by_time+append_list+delete_segments") // Appending to the list and deleting old segments
  .addOption("-hls_delete_threshold", "1") // Number of files to keep beyond the hls_list_size setting
  .output(outputPath)
  .on("start", () => {
    console.log("FFmpeg process started");
  })
  .on("end", () => {
    console.log("FFmpeg process finished");
  })
  .on("stderr", (stderrLine) => {
    console.log("  [FFmpeg] ", stderrLine);
  })
  .run();

console.log(
  "[startup] watching for new output.m3u8 to give signal to start streaming"
);
fs.watch(path.join(__dirname), (eventType, filename) => {
  if (!readyToStream && filename === outputFilename) {
    console.log(
      `\n\n[[[[[ fs.watch: saw ${outputFilename} change! OPENING THE PIPE! ]]]]]\n\n`
    );
    readyToStream = true;
  }
});

const cleanUpGhostFiles = () => {
  // Read the contents of the updated .m3u8 file
  fs.readFile(path.join(__dirname, outputFilename), "utf8", (err, data) => {
    if (err) {
      console.error(`Error reading ${outputFilename}:`, err);
      return;
    }

    // Extract the names of the .ts files that are still in use
    const usedSegments = new Set(data.match(/output\d+\.ts/g));

    // Read the root directory to get the list of all files
    fs.readdir(__dirname, (err, files) => {
      if (err) {
        console.error("Error reading root directory:", err);
        return;
      }

      // Filter out the .ts files that start with "output"
      const allSegments = new Set(
        files.filter(
          (file) => file.startsWith("output") && file.endsWith(".ts")
        )
      );

      // Find the .ts files that are no longer in use
      const unusedSegments = new Set(
        [...allSegments].filter((x) => !usedSegments.has(x))
      );

      // Delete the unused .ts files
      for (const segment of unusedSegments) {
        fs.unlink(path.join(__dirname, segment), (err) => {
          console.log("[cleanup] Cleaning up ghost file", segment);
          if (err) {
            console.error(`-- Error deleting ${segment}:`, err);
          } else {
            console.log(`-- Deleted unused segment: ${segment}`);
          }
        });
      }
    });
  });
};

cleanUpGhostFiles();

// app.get("/stream", async (req, res) => {
//   try {
//     console.log("got request to /stream");

//     if (!readyToStream) {
//       return res.status(500).send("Stream not ready. Try again soon.");
//     }

//     console.log("opening the pipe...");
//     res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
//     const readStream = fs.createReadStream(outputPath);
//     readStream.pipe(res);

//   } catch (err) {
//     console.error(err);
//     res.status(500).send(err);
//   }
// });

// app.get("/:segment.ts", (req, res) => {
//   const segmentFile = path.join(__dirname, req.params.segment + ".ts");
//   res.setHeader("Content-Type", "video/MP2T");
//   const readStream = fs.createReadStream(segmentFile);
//   readStream.pipe(res);
// });

app.use(
  route.get("/stream", async (ctx) => {
    console.log("got request to /stream");
    if (!readyToStream) {
      ctx.status = 500;
      ctx.body = "Stream not ready. Try again soon.";
      return;
    }

    console.log("opening the pipe...");
    ctx.set("Content-Type", "application/vnd.apple.mpegurl");
    ctx.body = fs.createReadStream(outputPath);
  })
);

app.use(
  route.get("/:segment.ts", (ctx, segment) => {
    const segmentFile = path.join(__dirname, segment + ".ts");
    ctx.set("Content-Type", "video/MP2T");
    ctx.body = fs.createReadStream(segmentFile);
  })
);

const certPath = path.join(__dirname, "localhost.pem");
const keyPath = path.join(__dirname, "localhost-key.pem");
const certExists = fs.existsSync(certPath);
const keyExists = fs.existsSync(keyPath);

if (certExists && keyExists) {
  // If both certificate and key exist, set up an HTTP/2 server
  server = http2.createSecureServer(
    {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    },
    app.callback()
  );
  console.log(`Starting an HTTP/2 server on https://localhost:${PORT}`);
} else {
  // If either is missing, set up a regular HTTP server
  server = http.createServer(app.callback());
  console.log(`Starting an HTTP server on http://localhost:${PORT}`);
}

server.listen(PORT);
