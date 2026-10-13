// Starts a program as the one macOS holds to its own privacy grants (Files and
// Folders, Full Disk Access, Automation) rather than the process that started
// it. A dev run of Studio is Terminal's, or whichever app started it, and so
// answers with that app's grants: a refusal, a first-read prompt, and the
// place a person undoes one cannot be seen from it.
//
//   OWN_PRIVACY_EXEC=<program> own-privacy [args...]
//
// The program is spawned rather than exec'd, since the attribute that disclaims
// responsibility applies only to a spawn, and this waits for it, passes on the
// signals that stop it, and exits as it did. The program stays in this
// process's group, so whatever stops the group stops it too.
//
// `responsibility_spawnattrs_setdisclaim` is private to libSystem but has been
// there since macOS 10.14; debuggers and IDEs launch with it for this reason.

#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs,
                                          int disclaim);

static pid_t child = 0;

static void pass_on(int signal) {
  if (child > 0) {
    kill(child, signal);
  }
}

int main(int argc, char **argv) {
  (void)argc;
  const char *named = getenv("OWN_PRIVACY_EXEC");
  if (named == NULL || *named == '\0') {
    fprintf(stderr, "own-privacy: OWN_PRIVACY_EXEC names no program\n");
    return 127;
  }
  char *program = strdup(named);
  unsetenv("OWN_PRIVACY_EXEC");

  struct sigaction action = {0};
  action.sa_handler = pass_on;
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGHUP, &action, NULL);

  posix_spawnattr_t attrs;
  posix_spawnattr_init(&attrs);
  responsibility_spawnattrs_setdisclaim(&attrs, 1);
  argv[0] = program;
  int failed = posix_spawn(&child, program, NULL, &attrs, argv, environ);
  posix_spawnattr_destroy(&attrs);
  if (failed != 0) {
    fprintf(stderr, "own-privacy: could not start %s: %s\n", program,
            strerror(failed));
    return 127;
  }

  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) {
      return 1;
    }
  }
  if (WIFSIGNALED(status)) {
    signal(WTERMSIG(status), SIG_DFL);
    raise(WTERMSIG(status));
  }
  return WEXITSTATUS(status);
}
