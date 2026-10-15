// instrument-seatbelt: start a program under a Seatbelt profile compiled
// once, rather than handing the profile's text to sandbox-exec, which
// compiles it again for every process (about 15 ms of a native command's
// start on an M-series Mac).
//
//   instrument-seatbelt compile < profile.sb > bytecode
//   instrument-seatbelt run <base64 bytecode> <program> [args...]
//
// `compile` writes the profile's bytecode to stdout. `run` applies it to
// itself and execs the program, which runs sandboxed with everything it
// starts. The bytecode is passed in argv rather than read from a file: a
// file a sandboxed program could rewrite would let one command loosen the
// next one's sandbox. If the profile cannot be applied, nothing runs: the
// helper exits 126 without exec'ing.
//
// sandbox_compile_string and sandbox_apply are libsandbox's, undeclared in
// the SDK; Chromium declares and uses the same pair (sandbox/mac/seatbelt.cc)
// to apply a profile its browser process compiled. The bytecode is never
// stored or shipped: it is compiled on the Mac that applies it.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct sandbox_profile {
  char *builtin;
  const unsigned char *data;
  size_t size;
};
typedef void *sandbox_params_t;
extern sandbox_params_t sandbox_create_params(void);
extern struct sandbox_profile *sandbox_compile_string(const char *,
                                                      sandbox_params_t,
                                                      char **);
extern int sandbox_apply(struct sandbox_profile *);

static int base64_value(int c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

static int compile(void) {
  size_t cap = 1 << 16, len = 0, n;
  char *text = malloc(cap);
  if (!text) return 1;
  while ((n = fread(text + len, 1, cap - len - 1, stdin)) > 0) {
    len += n;
    if (len + 1 >= cap) {
      char *grown = realloc(text, cap *= 2);
      if (!grown) return 1;
      text = grown;
    }
  }
  text[len] = 0;
  char *error = NULL;
  struct sandbox_profile *profile =
      sandbox_compile_string(text, sandbox_create_params(), &error);
  if (!profile || !profile->data || profile->size == 0) {
    fprintf(stderr, "instrument-seatbelt: compile: %s\n",
            error ? error : "no bytecode");
    return 1;
  }
  return fwrite(profile->data, 1, profile->size, stdout) == profile->size ? 0 : 1;
}

static int run(const char *encoded, char **argv) {
  size_t len = strlen(encoded), out = 0;
  unsigned char *data = malloc(len + 1);
  if (!data) return 126;
  unsigned int acc = 0;
  int bits = 0;
  for (size_t i = 0; i < len; i++) {
    int v = base64_value((unsigned char)encoded[i]);
    if (v < 0) continue;
    acc = (acc << 6) | (unsigned int)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      data[out++] = (acc >> bits) & 0xff;
    }
  }
  struct sandbox_profile profile = {NULL, data, out};
  if (out == 0 || sandbox_apply(&profile) != 0) {
    perror("instrument-seatbelt: sandbox_apply");
    return 126;
  }
  execv(argv[0], argv);
  fprintf(stderr, "instrument-seatbelt: %s: ", argv[0]);
  perror(NULL);
  return 127;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "compile") == 0) return compile();
  if (argc >= 4 && strcmp(argv[1], "run") == 0) return run(argv[2], &argv[3]);
  fprintf(stderr,
          "usage: instrument-seatbelt compile < profile.sb\n"
          "       instrument-seatbelt run <bytecode> <program> [args...]\n");
  return 2;
}
