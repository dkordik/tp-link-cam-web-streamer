const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const https = require("https");

const SECRETS = require("./secrets");
const PORT = "3313";

const app = express();
app.use(cors());

let readyToStream = false;

const outputFilename = "output.m3u8";
const outputPath = path.join(__dirname, outputFilename);

(async () => {
  console.log("[startup] connecting to source...");

  // tplink https stream uses a self-signed cert, which we need to allow
  const agent = new https.Agent({
    rejectUnauthorized: false,
  });

  const response = await axios({
    method: "get",
    url: `https://${SECRETS.ip}:19443/`
      + `https/stream/mixed?video=h264&audio=g711&resolution=hd`,
    auth: {
      username: SECRETS.username,
      password: SECRETS.password,
    },
    httpsAgent: agent,
    responseType: "stream",
  });
  
  console.log("[startup] connection succeeded to source.");
  

  console.log("[startup] beginning ffmpeg pipeline");
  ffmpeg(response.data)
    .inputFormat("h264")
    .videoCodec("libx264")
    .addOption("-an") // No audio
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

  console.log("[startup] watching for new output.m3u8 to give signal to start streaming");
  fs.watch(path.join(__dirname), (eventType, filename) => {
    if (!readyToStream && filename === outputFilename) {
      console.log(`\n\n[[[[[ fs.watch: saw ${outputFilename} change! OPENING THE PIPE! ]]]]]\n\n`);
      readyToStream = true;
    }
  });
})();

const cleanUpGhostFiles = () => {
  // Read the contents of the updated .m3u8 file
  fs.readFile(path.join(__dirname, "output.m3u8"), "utf8", (err, data) => {
    if (err) {
      console.error(`Error reading ${filename}:`, err);
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
}


cleanUpGhostFiles();

app.get("/stream", async (req, res) => {
  try {
    console.log("got request to /stream");

    if (!readyToStream) {
      return res.status(500).send("Stream not ready. Try again soon.");
    }

    console.log("opening the pipe...");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);

  } catch (err) {
    console.error(err);
    res.status(500).send(err);
  }
});

app.get("/:segment.ts", (req, res) => {
  const segmentFile = path.join(__dirname, req.params.segment + ".ts");
  res.setHeader("Content-Type", "video/MP2T");
  const readStream = fs.createReadStream(segmentFile);
  readStream.pipe(res);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
