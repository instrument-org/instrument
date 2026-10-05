// The in-process half of the Mac bridge, loaded by Instrument's main process
// as instrument-mac.node. It answers what macOS keys to the app itself, where
// a helper process would be asked about the wrong app: notification
// permission belongs to the bundle that shows the notification.
//
// Every function returns a Promise of JSON text, built by `answer`. Adding one
// is a block in `FUNCTIONS` that calls `done` with a dictionary (or an
// `error` string); main parses it in mac-native.ts, which is where its type
// lives. Node-API is ABI-stable, so one build serves every Electron version.

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>

typedef void (^Done)(NSDictionary *result);
typedef void (^Work)(Done done);

/// Resolves the promise on the JS thread with the JSON the work produced.
static void settle(napi_env env, napi_value js_callback, void *context, void *data) {
  napi_deferred deferred = context;
  char *json = data;
  if (env != NULL) {
    napi_value text;
    napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &text);
    napi_resolve_deferred(env, deferred, text);
  }
  free(json);
}

/// Runs `work` off the JS thread and hands back a Promise of its JSON.
static napi_value answer(napi_env env, Work work) {
  napi_deferred deferred;
  napi_value promise;
  napi_create_promise(env, &deferred, &promise);
  napi_value name;
  napi_create_string_utf8(env, "instrument-mac", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function tsfn;
  napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, NULL, deferred, settle,
                                  &tsfn);
  work(^(NSDictionary *result) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    NSString *text = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
                          : @"{\"error\":\"could not encode the answer\"}";
    napi_call_threadsafe_function(tsfn, strdup(text.UTF8String), napi_tsfn_blocking);
    napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  });
  return promise;
}

static NSString *authorizationName(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusAuthorized:
      return @"allowed";
    case UNAuthorizationStatusDenied:
      return @"denied";
    case UNAuthorizationStatusProvisional:
      return @"provisional";
    case UNAuthorizationStatusNotDetermined:
      return @"not-asked";
    default:
      return @"unknown";
  }
}

/// Apple's notification center exists only for an app bundle; anywhere
/// else (plain node, a test) asking for it raises an exception that ends the
/// process, so every caller checks first.
static BOOL inAppBundle(void) {
  return NSBundle.mainBundle.bundleIdentifier != nil &&
         [NSBundle.mainBundle.bundleURL.pathExtension isEqualToString:@"app"];
}

/// Whether macOS lets the app show notifications, and how they arrive.
static napi_value notificationStatus(napi_env env, napi_callback_info info) {
  return answer(env, ^(Done done) {
    if (!inAppBundle()) {
      done(@{@"status" : @"unsupported"});
      return;
    }
    [UNUserNotificationCenter.currentNotificationCenter
        getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
          done(@{
            @"status" : authorizationName(settings.authorizationStatus),
            // @YES and @NO, not @(a == b): a boxed comparison is a number,
            // and JSON would carry it as 0 or 1.
            @"alerts" : settings.alertSetting == UNNotificationSettingEnabled ? @YES : @NO,
            @"sounds" : settings.soundSetting == UNNotificationSettingEnabled ? @YES : @NO,
          });
        }];
  });
}

/// Asks macOS for permission now: the system's prompt the first time,
/// nothing after the user has answered it.
static napi_value requestNotifications(napi_env env, napi_callback_info info) {
  return answer(env, ^(Done done) {
    if (!inAppBundle()) {
      done(@{@"error" : @"notifications are only for the app itself, not a process outside it"});
      return;
    }
    UNAuthorizationOptions options =
        UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
    [UNUserNotificationCenter.currentNotificationCenter
        requestAuthorizationWithOptions:options
                      completionHandler:^(BOOL granted, NSError *error) {
                        if (error != nil) {
                          done(@{@"error" : error.localizedDescription});
                        } else {
                          done(@{@"granted" : @(granted)});
                        }
                      }];
  });
}

static const struct {
  const char *name;
  napi_callback fn;
} FUNCTIONS[] = {
    {"notificationStatus", notificationStatus},
    {"requestNotifications", requestNotifications},
};

NAPI_MODULE_INIT() {
  for (size_t i = 0; i < sizeof(FUNCTIONS) / sizeof(FUNCTIONS[0]); i++) {
    napi_value fn;
    napi_create_function(env, FUNCTIONS[i].name, NAPI_AUTO_LENGTH, FUNCTIONS[i].fn, NULL, &fn);
    napi_set_named_property(env, exports, FUNCTIONS[i].name, fn);
  }
  return exports;
}
