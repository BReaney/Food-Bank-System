import express from "express";
import cors from "cors";

const app = express();
const PORT = 3001;

// Allow requests from our local React application.
app.use(cors({ origin: "http://localhost:5173" }));

// Allow the server to read JSON request bodies.
app.use(express.json());

// A simple route to check that the backend is running.
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "UVSS Food Bank API is running"
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});