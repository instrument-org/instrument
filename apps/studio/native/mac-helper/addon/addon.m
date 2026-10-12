// The in-process half of the Mac bridge, loaded by Instrument's main process
// as instrument-mac.node. It answers what macOS keys to the app itself, where
// a helper process would be asked about the wrong app: notification
// permission belongs to the bundle that shows the notification. It also
// answers what the file browser asks of every folder it lists, which comes
// too often to start a process for.
//
// Every function returns a Promise of JSON text, built by `answer`. Adding one
// is a block in `FUNCTIONS` that calls `done` with a dictionary (or an
// `error` string); main parses it in mac-native.ts, which is where its type
// lives. Node-API is ABI-stable, so one build serves every Electron version.

#import <AppKit/AppKit.h>
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

/// The call's string arguments, in order; nil for one that is not a string.
static NSArray *stringArguments(napi_env env, napi_callback_info info, size_t count) {
  napi_value argv[4];
  size_t argc = count < 4 ? count : 4;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSMutableArray *strings = [NSMutableArray array];
  for (size_t i = 0; i < argc; i++) {
    size_t length = 0;
    if (napi_get_value_string_utf8(env, argv[i], NULL, 0, &length) != napi_ok) {
      [strings addObject:NSNull.null];
      continue;
    }
    char *buffer = malloc(length + 1);
    napi_get_value_string_utf8(env, argv[i], buffer, length + 1, &length);
    [strings addObject:[NSString stringWithUTF8String:buffer] ?: (id)NSNull.null];
    free(buffer);
  }
  return strings;
}

/// What the Finder knows about each entry of a folder beyond what `stat`
/// says: whether it is a package (an app, a Photos library) that the Finder
/// shows as one item, whether its extension is hidden, whether it is hidden,
/// and whether it is an alias. Only entries with something to say are named,
/// and a package carries its kind as the Finder writes it.
///
/// Off the JS thread, which is AppKit's main thread in Electron: a folder of
/// thousands is a few milliseconds, but not ones to take from the window.
static napi_value finderEntries(napi_env env, napi_callback_info info) {
  NSArray *args = stringArguments(env, info, 1);
  NSString *folder = args.count > 0 && args[0] != NSNull.null ? args[0] : nil;
  return answer(env, ^(Done done) {
    if (folder == nil) {
      done(@{@"error" : @"a folder path is required"});
      return;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSArray<NSURLResourceKey> *keys = @[
        NSURLIsPackageKey, NSURLHasHiddenExtensionKey, NSURLIsHiddenKey,
        NSURLIsAliasFileKey, NSURLIsSymbolicLinkKey, NSURLLocalizedTypeDescriptionKey
      ];
      NSError *error = nil;
      NSArray<NSURL *> *urls = [NSFileManager.defaultManager
            contentsOfDirectoryAtURL:[NSURL fileURLWithPath:folder isDirectory:YES]
          includingPropertiesForKeys:keys
                             options:0
                               error:&error];
      if (urls == nil) {
        done(@{@"error" : error.localizedDescription ?: @"could not read the folder"});
        return;
      }
      NSMutableArray *entries = [NSMutableArray array];
      for (NSURL *url in urls) {
        NSDictionary<NSURLResourceKey, id> *values = [url resourceValuesForKeys:keys error:nil];
        BOOL isPackage = [values[NSURLIsPackageKey] boolValue];
        BOOL hidesExtension = [values[NSURLHasHiddenExtensionKey] boolValue];
        BOOL isHidden = [values[NSURLIsHiddenKey] boolValue];
        // A symbolic link answers as an alias too; the browser already
        // follows those itself.
        BOOL isAlias = [values[NSURLIsAliasFileKey] boolValue] &&
                       ![values[NSURLIsSymbolicLinkKey] boolValue];
        if (!isPackage && !hidesExtension && !isHidden && !isAlias) {
          continue;
        }
        NSMutableDictionary *entry = [@{@"name" : url.lastPathComponent} mutableCopy];
        if (isPackage) {
          entry[@"package"] = @YES;
          NSString *kind = values[NSURLLocalizedTypeDescriptionKey];
          if (kind != nil) {
            entry[@"kind"] = kind;
          }
        }
        if (hidesExtension) entry[@"hidesExtension"] = @YES;
        if (isHidden) entry[@"hidden"] = @YES;
        if (isAlias) entry[@"alias"] = @YES;
        [entries addObject:entry];
      }
      done(@{@"entries" : entries});
    });
  });
}

/// The icon the Finder draws for a file, folder or app, as a PNG of the size
/// asked for in pixels, in base64. An app's own icon, not a folder's.
static napi_value fileIcon(napi_env env, napi_callback_info info) {
  NSArray *args = stringArguments(env, info, 2);
  NSString *path = args.count > 0 && args[0] != NSNull.null ? args[0] : nil;
  NSInteger pixels = args.count > 1 && args[1] != NSNull.null ? [args[1] integerValue] : 0;
  return answer(env, ^(Done done) {
    if (path == nil || pixels <= 0) {
      done(@{@"error" : @"a path and a size are required"});
      return;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
        done(@{@"error" : @"nothing is at that path"});
        return;
      }
      NSImage *icon = [NSWorkspace.sharedWorkspace iconForFile:path];
      // Drawn into a bitmap of exactly the pixels asked for: asked for an
      // image alone, the icon hands back whichever stored size is nearest.
      NSBitmapImageRep *bitmap =
          [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL
                                                  pixelsWide:pixels
                                                  pixelsHigh:pixels
                                               bitsPerSample:8
                                             samplesPerPixel:4
                                                    hasAlpha:YES
                                                    isPlanar:NO
                                              colorSpaceName:NSDeviceRGBColorSpace
                                                 bytesPerRow:0
                                                bitsPerPixel:0];
      NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
      [NSGraphicsContext saveGraphicsState];
      NSGraphicsContext.currentContext = context;
      context.imageInterpolation = NSImageInterpolationHigh;
      [icon drawInRect:NSMakeRect(0, 0, pixels, pixels)
              fromRect:NSZeroRect
             operation:NSCompositingOperationCopy
              fraction:1];
      [NSGraphicsContext restoreGraphicsState];
      NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
      if (png == nil) {
        done(@{@"error" : @"the icon could not be drawn"});
        return;
      }
      done(@{@"png" : [png base64EncodedStringWithOptions:0]});
    });
  });
}

/// Where a Finder alias points, without asking anyone to sign in to a server
/// or mounting a volume to find out; an error for a path that is not an alias
/// or whose target is gone.
static napi_value resolveAlias(napi_env env, napi_callback_info info) {
  NSArray *args = stringArguments(env, info, 1);
  NSString *path = args.count > 0 && args[0] != NSNull.null ? args[0] : nil;
  return answer(env, ^(Done done) {
    if (path == nil) {
      done(@{@"error" : @"a path is required"});
      return;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSURL *url = [NSURL fileURLWithPath:path];
      NSNumber *isAlias = nil;
      [url getResourceValue:&isAlias forKey:NSURLIsAliasFileKey error:nil];
      if (!isAlias.boolValue) {
        done(@{@"error" : @"not an alias"});
        return;
      }
      NSError *error = nil;
      NSURL *target = [NSURL URLByResolvingAliasFileAtURL:url
                                                  options:NSURLBookmarkResolutionWithoutUI |
                                                          NSURLBookmarkResolutionWithoutMounting
                                                    error:&error];
      if (target == nil) {
        done(@{@"error" : error.localizedDescription ?: @"the alias leads nowhere"});
        return;
      }
      done(@{@"path" : target.path});
    });
  });
}

static const struct {
  const char *name;
  napi_callback fn;
} FUNCTIONS[] = {
    {"fileIcon", fileIcon},
    {"finderEntries", finderEntries},
    {"resolveAlias", resolveAlias},
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
