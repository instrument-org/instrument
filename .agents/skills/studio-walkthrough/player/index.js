// The player's one bundle: each page calls the mount it is for.
import "./engine.css";
import "./pages.css";
import { mountChapters } from "./chapters.js";
import { mountRender } from "./render.js";
import { mountSnippets } from "./snippets.js";

window.Walkthrough = { mountChapters, mountRender, mountSnippets };
