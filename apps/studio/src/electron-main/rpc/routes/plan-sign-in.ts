import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";

const live = {
  /**
   * Each plan's sign-in page to open in a tab. Every window hears it, and the
   * one whose sign-in it is opens it.
   */
  page: base.handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe("plan-sign-in.page", {
      signal,
    })) {
      yield event;
    }
  }),
};

export const planSignIn = { live };
