const probe = () => {
  const out = {};
  const attempt = (name, fn) => {
    try {
      out[name] = fn();
    } catch (error) {
      out[name] = { error: String(error) };
    }
  };

  attempt("webdriver", () => ({
    value: navigator.webdriver,
    ownDescriptor:
      Object.getOwnPropertyDescriptor(navigator, "webdriver") != null,
  }));

  attempt("windowChrome", () => {
    const chrome = window.chrome;
    return chrome == null
      ? null
      : {
          keys: Object.keys(chrome),
          hasRuntime: "runtime" in chrome,
          hasCsi: "csi" in chrome,
          hasLoadTimes: "loadTimes" in chrome,
        };
  });

  attempt("dimensions", () => ({
    inner: [window.innerWidth, window.innerHeight],
    outer: [window.outerWidth, window.outerHeight],
    chromeFrameDelta: window.outerHeight - window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screen: {
      wh: [screen.width, screen.height],
      avail: [screen.availWidth, screen.availHeight],
      availOffset: [screen.availLeft, screen.availTop],
      depth: [screen.colorDepth, screen.pixelDepth],
    },
  }));

  attempt("plugins", () => ({
    count: navigator.plugins.length,
    names: Array.from(navigator.plugins).map((p) => p.name),
    mimeTypes: navigator.mimeTypes.length,
  }));

  attempt("hardware", () => ({
    languages: navigator.languages,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    platform: navigator.platform,
  }));

  attempt("identity", () => ({
    userAgent: navigator.userAgent,
    brands: navigator.userAgentData?.brands ?? null,
    mobile: navigator.userAgentData?.mobile ?? null,
    uaPlatform: navigator.userAgentData?.platform ?? null,
  }));

  attempt("webgl", () => {
    const gl = document.createElement("canvas").getContext("webgl");
    if (gl == null) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext == null
      ? { debugInfo: false }
      : {
          vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
          renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        };
  });

  attempt("codecs", () => {
    const v = document.createElement("video");
    const a = document.createElement("audio");
    return {
      h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
      mp3: a.canPlayType("audio/mpeg"),
      ogg: v.canPlayType('video/ogg; codecs="theora"'),
    };
  });

  attempt("runtimeEnableBait", () => {
    let tripped = false;
    const bait = /instrument-probe/;
    bait.toString = () => {
      tripped = true;
      return "bait";
    };
    console.debug(bait);
    return { tripped };
  });

  attempt("nativeToString", () => ({
    fetch: Function.prototype.toString.call(window.fetch),
    getParameter: Function.prototype.toString.call(
      WebGLRenderingContext.prototype.getParameter,
    ),
  }));

  return new Promise((resolve) => {
    const finish = () => resolve(out);
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) finish();
    };

    try {
      Promise.all([
        navigator.permissions
          .query({ name: "notifications" })
          .then((s) => s.state),
        Promise.resolve(Notification.permission),
      ]).then(
        ([queried, declared]) => {
          out.permissions = {
            queried,
            declared,
            contradiction: declared === "denied" && queried === "prompt",
          };
          done();
        },
        (error) => {
          out.permissions = { error: String(error) };
          done();
        },
      );
    } catch (error) {
      out.permissions = { error: String(error) };
      done();
    }

    try {
      const source =
        "self.postMessage({webdriver: navigator.webdriver, hc: navigator.hardwareConcurrency, ua: navigator.userAgent, brands: navigator.userAgentData ? navigator.userAgentData.brands : null});";
      const worker = new Worker(
        URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
      );
      const timer = setTimeout(() => {
        out.worker = { error: "timeout" };
        done();
      }, 3000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        out.worker = event.data;
        worker.terminate();
        done();
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        out.worker = { error: String(event.message ?? event) };
        done();
      };
    } catch (error) {
      out.worker = { error: String(error) };
      done();
    }
  });
};

// Read the automation-visible surface of a task browser guest, for comparing
// against what a real Chrome reports. Pass `--args '{"taskId":"..."}'` to pick a
// guest when the pool holds more than one; the first mounted guest is the
// default. Open a page in the guest first -- an `about:blank` guest reports
// little.
export default async (app, args) => {
  const taskId = args?.taskId ?? "";
  const result = await app.eval(`(async () => {
    const guests = Array.from(document.querySelectorAll("webview"));
    const wanted = ${JSON.stringify(taskId)};
    const target = (wanted === "" ? null : guests.find((w) => w.getAttribute("partition")?.includes(wanted))) ?? guests[0];
    if (target == null) return { error: "no webview guest mounted", guests: guests.length };
    const payload = await target.executeJavaScript("(" + ${JSON.stringify(probe.toString())} + ")()");
    return { url: target.getAttribute("src"), payload };
  })()`);
  return result;
};
