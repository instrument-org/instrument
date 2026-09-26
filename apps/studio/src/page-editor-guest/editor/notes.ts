/**
 * What the editor tells the person about something it leaves to the agent:
 * the longer note under an ask, and the one line a disabled duplicate or
 * delete button gives.
 */
import { type Blocked, REASONS } from "./classify";

/** Why the agent, not the editor, should make a change here. */
export function noteFor(v: Blocked) {
  switch (v.reason) {
    case "changed": {
      return "A script rewrites this after the page loads, so a change here would be overwritten.";
    }
    case "copied": {
      return "A script copies this from a template. The agent will change the source it is copied from.";
    }
    case "data": {
      const n = v.shadows?.length ?? 0;
      return `This text also lives in the page's data (${n} ${n === 1 ? "place" : "places"}), so the agent should change every copy.`;
    }
    case "generated": {
      return "A script draws this, so it is not in the file as you see it. The agent will change the data or code behind it.";
    }
    case "layout": {
      return "";
    }
    case "markup": {
      return "This text has markup the editor does not rewrite safely.";
    }
    case "page-css": {
      return "The page’s own stylesheet decides this here, so a class has no effect. The agent can change the stylesheet.";
    }
    case "responsive": {
      return "A screen-size rule sets this at the current width. The agent can change it for every size.";
    }
    case "root": {
      return "This is the page itself.";
    }
    case "script-class": {
      return "A script sets this element’s classes after the page loads, so a style change here would be undone.";
    }
    case "script-reads": {
      return `A script finds this by ${v.detail ?? "its attributes"}, so moving or removing it could break the page.`;
    }
  }
}

/** Why duplicate or delete is off for this element, in one short line. */
export function structWhy(v: Blocked, act: "delete" | "duplicate") {
  const verb = act === "duplicate" ? "copying" : "removing";
  switch (v.reason) {
    case "changed": {
      return "A script changes this part of the page after it loads.";
    }
    case "copied": {
      return "A script copies this from a template.";
    }
    case "data": {
      return "Its text is also in the page’s data.";
    }
    case "generated": {
      return "A script makes this, so it is not in the file.";
    }
    case "root": {
      return "This holds the whole page.";
    }
    case "script-reads": {
      return `A script uses ${v.detail ?? "it"}, so ${verb} it could break the page.`;
    }
    default: {
      return REASONS[v.reason];
    }
  }
}
