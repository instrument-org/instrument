// The in-process half of the Mac bridge, loaded by Instrument's main process
// as instrument-mac.node. It answers what macOS keys to the app itself, where
// a helper process would be asked about the wrong app: notification
// permission belongs to the bundle that shows the notification. It also
// answers what the file browser asks of every folder it lists, which comes
// too often to start a process for.
//
// Every function but `watchTrackpadTouches`, which calls back for as long as
// the app runs, returns a Promise of JSON text, built by `answer`. Adding one
// is a block in `FUNCTIONS` that calls `done` with a dictionary (or an
// `error` string); main parses it in mac-native.ts, which is where its type
// lives. Node-API is ABI-stable, so one build serves every Electron version.

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>
#include <stdio.h>
#include <unistd.h>

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

/// The identifier macOS files this app's settings under, notifications
/// included: the build's own in a packaged app, Electron's in a dev run.
static napi_value bundleIdentifier(napi_env env, napi_callback_info info) {
  return answer(env, ^(Done done) {
    NSString *identifier = NSBundle.mainBundle.bundleIdentifier;
    done(identifier != nil ? @{@"bundleId" : identifier} : @{});
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

/// The files on the general pasteboard, every one of them: the Finder's Copy
/// puts each on an item of its own, where Electron's clipboard reads only the
/// first. Read where it is called, on AppKit's thread, which is quick.
static napi_value pasteboardFiles(napi_env env, napi_callback_info info) {
  return answer(env, ^(Done done) {
    NSArray<NSURL *> *urls = [NSPasteboard.generalPasteboard
        readObjectsForClasses:@[ NSURL.class ]
                      options:@{NSPasteboardURLReadingFileURLsOnlyKey : @YES}];
    NSMutableArray<NSString *> *paths = [NSMutableArray array];
    for (NSURL *url in urls ?: @[]) {
      if (url.path != nil) {
        [paths addObject:url.path];
      }
    }
    done(@{@"paths" : paths});
  });
}

/// An errno by the name Node gives it, so main reads a failure as it would
/// one of its own.
static NSString *errnoName(int code) {
  switch (code) {
    case EACCES: return @"EACCES";
    case EEXIST: return @"EEXIST";
    case EINVAL: return @"EINVAL";
    case EISDIR: return @"EISDIR";
    case ENOENT: return @"ENOENT";
    case ENOSPC: return @"ENOSPC";
    case ENOTDIR: return @"ENOTDIR";
    case ENOTEMPTY: return @"ENOTEMPTY";
    case ENOTSUP: return @"ENOTSUP";
    case EPERM: return @"EPERM";
    case EROFS: return @"EROFS";
    case EXDEV: return @"EXDEV";
    default: return [NSString stringWithFormat:@"E%d", code];
  }
}

/// A rename that fails rather than replace what is at the new name:
/// `renamex_np` with RENAME_EXCL, which the file system checks and renames
/// in one step, so nothing can take the name in between.
static napi_value renameExclusive(napi_env env, napi_callback_info info) {
  NSArray *args = stringArguments(env, info, 2);
  NSString *from = args.count > 0 && args[0] != NSNull.null ? args[0] : nil;
  NSString *to = args.count > 1 && args[1] != NSNull.null ? args[1] : nil;
  return answer(env, ^(Done done) {
    if (from == nil || to == nil) {
      done(@{@"error" : @"two paths are required", @"code" : @"EINVAL"});
      return;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      if (renamex_np(from.fileSystemRepresentation, to.fileSystemRepresentation, RENAME_EXCL) ==
          0) {
        done(@{@"renamed" : @YES});
        return;
      }
      int code = errno;
      done(@{@"error" : @(strerror(code)), @"code" : errnoName(code)});
    });
  });
}

/// Moves a thing to the Trash and says where it landed, which the app could
/// not find by reading the Trash without Full Disk Access.
static napi_value trashItem(napi_env env, napi_callback_info info) {
  NSArray *args = stringArguments(env, info, 1);
  NSString *path = args.count > 0 && args[0] != NSNull.null ? args[0] : nil;
  return answer(env, ^(Done done) {
    if (path == nil) {
      done(@{@"error" : @"a path is required"});
      return;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSURL *landed = nil;
      NSError *error = nil;
      if (![NSFileManager.defaultManager trashItemAtURL:[NSURL fileURLWithPath:path]
                                       resultingItemURL:&landed
                                                  error:&error]) {
        done(@{@"error" : error.localizedDescription ?: @"it could not be moved to the Trash"});
        return;
      }
      done(landed.path != nil ? @{@"trashed" : landed.path} : @{@"trashed" : NSNull.null});
    });
  });
}

/// Whether the disk a path is on tells names apart by case, as the disk
/// itself says: APFS and HFS+ answer either way, and most others do too.
static napi_value caseSensitivity(napi_env env, napi_callback_info info) {
  NSArray *args = stringArguments(env, info, 1);
  NSString *path = args.count > 0 && args[0] != NSNull.null ? args[0] : nil;
  return answer(env, ^(Done done) {
    if (path == nil) {
      done(@{@"error" : @"a path is required"});
      return;
    }
    errno = 0;
    long sensitive = pathconf(path.fileSystemRepresentation, _PC_CASE_SENSITIVE);
    if (sensitive < 0) {
      done(@{@"error" : errno == 0 ? @"the disk does not say" : @(strerror(errno))});
      return;
    }
    done(@{@"caseSensitive" : sensitive == 1 ? @YES : @NO});
  });
}

/// Whether macOS lets the app control another app with Apple Events, asked
/// by its bundle id, without sending one: allowed, denied, not-asked, or
/// not-running, since macOS answers for a running app alone. With "request"
/// as the second argument, a question nobody has answered raises the
/// system's prompt and waits for the answer. Here, not in the helper: the
/// app's own process holds the Apple Events entitlement.
static napi_value automationStatus(napi_env env, napi_callback_info info) {
  NSArray *args = stringArguments(env, info, 2);
  NSString *bundleId = args.count > 0 && args[0] != NSNull.null ? args[0] : nil;
  BOOL request = args.count > 1 && [args[1] isEqual:@"request"];
  return answer(env, ^(Done done) {
    if (bundleId == nil) {
      done(@{@"error" : @"a bundle id is required"});
      return;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSData *bytes = [bundleId dataUsingEncoding:NSUTF8StringEncoding];
      AEAddressDesc target;
      if (AECreateDesc(typeApplicationBundleID, bytes.bytes, (Size)bytes.length, &target) !=
          noErr) {
        done(@{@"error" : @"could not name the app"});
        return;
      }
      OSStatus status =
          AEDeterminePermissionToAutomateTarget(&target, typeWildCard, typeWildCard, request);
      AEDisposeDesc(&target);
      switch (status) {
        case noErr:
          done(@{@"status" : @"allowed"});
          break;
        case errAEEventNotPermitted:
          done(@{@"status" : @"denied"});
          break;
        case errAEEventWouldRequireUserConsent:
          done(@{@"status" : @"not-asked"});
          break;
        case procNotFound:
          done(@{@"status" : @"not-running"});
          break;
        default:
          done(@{@"status" : @"unknown"});
      }
    });
  });
}

/// Whether one of macOS's own permission prompts is on screen: a window of
/// UserNotificationCenter, the process that draws the prompts for folders and
/// apps. The window list names a window's owner without the screen recording
/// permission, which only its title needs.
static napi_value promptOnScreen(napi_env env, napi_callback_info info) {
  return answer(env, ^(Done done) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      CFArrayRef windows =
          CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
      BOOL shown = NO;
      for (NSDictionary *window in (__bridge NSArray *)windows) {
        if ([window[(__bridge NSString *)kCGWindowOwnerName]
                isEqualToString:@"UserNotificationCenter"]) {
          shown = YES;
          break;
        }
      }
      if (windows != NULL) {
        CFRelease(windows);
      }
      done(@{@"onScreen" : shown ? @YES : @NO});
    });
  });
}

/// Hands one trackpad touch, "down" or "up", to the JS callback it is for.
static void callWithTouch(napi_env env, napi_value js_callback, void *context, void *data) {
  char *touch = data;
  if (env != NULL) {
    napi_value text;
    napi_value undefined;
    napi_create_string_utf8(env, touch, NAPI_AUTO_LENGTH, &text);
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, js_callback, 1, &text, NULL);
  }
  free(touch);
}

/// Calls the callback it is given with "down" when fingers come down on the
/// trackpad to scroll and "up" when they lift, which a page's wheel events
/// never say: the momentum after a lift arrives as more wheel, and fingers
/// held still send none. Read off the scroll events' own phase, for the app's
/// windows only, through a local monitor that passes every event on as it
/// came. The first call starts it and later calls do nothing; it does not
/// keep the process alive.
static napi_value watchTrackpadTouches(napi_env env, napi_callback_info info) {
  static napi_threadsafe_function watching = NULL;
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  if (watching != NULL || argc < 1) {
    return undefined;
  }
  napi_value name;
  napi_create_string_utf8(env, "instrument-mac-touches", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, callWithTouch,
                                  &watching);
  napi_unref_threadsafe_function(env, watching);
  napi_threadsafe_function tsfn = watching;
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
                                          handler:^NSEvent *(NSEvent *event) {
                                            const char *touch = NULL;
                                            if (event.phase & (NSEventPhaseMayBegin | NSEventPhaseBegan)) {
                                              touch = "down";
                                            } else if (event.phase &
                                                       (NSEventPhaseEnded | NSEventPhaseCancelled)) {
                                              touch = "up";
                                            }
                                            if (touch != NULL) {
                                              napi_call_threadsafe_function(tsfn, strdup(touch),
                                                                            napi_tsfn_nonblocking);
                                            }
                                            return event;
                                          }];
  });
  return undefined;
}

static const struct {
  const char *name;
  napi_callback fn;
} FUNCTIONS[] = {
    {"automationStatus", automationStatus},
    {"promptOnScreen", promptOnScreen},
    {"fileIcon", fileIcon},
    {"finderEntries", finderEntries},
    {"pasteboardFiles", pasteboardFiles},
    {"renameExclusive", renameExclusive},
    {"caseSensitivity", caseSensitivity},
    {"trashItem", trashItem},
    {"resolveAlias", resolveAlias},
    {"notificationStatus", notificationStatus},
    {"requestNotifications", requestNotifications},
    {"bundleIdentifier", bundleIdentifier},
    {"watchTrackpadTouches", watchTrackpadTouches},
};

NAPI_MODULE_INIT() {
  for (size_t i = 0; i < sizeof(FUNCTIONS) / sizeof(FUNCTIONS[0]); i++) {
    napi_value fn;
    napi_create_function(env, FUNCTIONS[i].name, NAPI_AUTO_LENGTH, FUNCTIONS[i].fn, NULL, &fn);
    napi_set_named_property(env, exports, FUNCTIONS[i].name, fn);
  }
  return exports;
}
