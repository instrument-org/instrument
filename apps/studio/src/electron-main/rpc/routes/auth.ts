import {
  signInSocial as signInSocialFn,
  signOut as signOutFn,
} from "@/electron-main/auth/client";
import { hasToken as hasTokenUtil } from "@/electron-main/platform-api/utils";
import { base } from "@/electron-main/rpc/base";

import { publisher } from "../publisher";

const signOut = base.handler(async () => {
  await signOutFn();
});

const hasToken = base.handler(() => {
  return hasTokenUtil();
});

const live = {
  hasToken: base.handler(async function* ({ signal }) {
    yield hasTokenUtil();

    for await (const _ of publisher.subscribe(
      "session.apiBearerToken.updated",
      {
        signal,
      },
    )) {
      yield hasTokenUtil();
    }
  }),
};

const signInSocial = base.handler(async () => {
  return signInSocialFn();
});

export const auth = {
  hasToken,
  live,
  signInSocial,
  signOut,
};
