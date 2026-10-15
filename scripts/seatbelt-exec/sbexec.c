// sbexec compile < profile.sb > bytecode     compile a profile once
// sbexec run <base64 bytecode> <program> [args...]   apply it, then exec
// The bytecode travels in argv, never through a file a sandboxed program
// could rewrite. Uses libsandbox's private compile/apply pair, as
// Chromium's seatbelt does.
//
// A spike, not built by anything: `cc -O2 -o sbexec sbexec.c -lsandbox`,
// then point INSTRUMENT_SEATBELT_HELPER at the binary and wrapNativeCommand
// (packages/workspace/src/lib/native-sandbox.ts) uses it in place of
// sandbox-exec. See docs/findings/gnu-text-commands-on-bundled-uutils.md.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct sandbox_profile {
  char *builtin;
  unsigned char *data;
  size_t size;
};
typedef void *sandbox_params_t;
extern sandbox_params_t sandbox_create_params(void);
extern struct sandbox_profile *sandbox_compile_string(const char *, sandbox_params_t, char **);
extern int sandbox_apply(struct sandbox_profile *);

static int b64(int c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "compile") == 0) {
    size_t cap = 1 << 16, len = 0;
    char *text = malloc(cap);
    size_t n;
    while ((n = fread(text + len, 1, cap - len - 1, stdin)) > 0) {
      len += n;
      if (len + 1 >= cap) text = realloc(text, cap *= 2);
    }
    text[len] = 0;
    char *err = NULL;
    struct sandbox_profile *p = sandbox_compile_string(text, sandbox_create_params(), &err);
    if (!p) { fprintf(stderr, "compile: %s\n", err ? err : "?"); return 1; }
    fwrite(p->data, 1, p->size, stdout);
    return 0;
  }
  if (argc >= 4 && strcmp(argv[1], "run") == 0) {
    const char *in = argv[2];
    size_t len = strlen(in);
    unsigned char *data = malloc(len);
    size_t out = 0;
    unsigned int acc = 0;
    int bits = 0;
    for (size_t i = 0; i < len; i++) {
      int v = b64((unsigned char)in[i]);
      if (v < 0) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; data[out++] = (acc >> bits) & 0xff; }
    }
    struct sandbox_profile p = { NULL, data, out };
    if (sandbox_apply(&p) != 0) { perror("sbexec: sandbox_apply"); return 126; }
    execv(argv[3], &argv[3]);
    fprintf(stderr, "sbexec: %s: ", argv[3]);
    perror(NULL);
    return 127;
  }
  fprintf(stderr, "usage: sbexec compile | run <bytecode> <program> [args...]\n");
  return 2;
}
