import { definePlugin, defineRule } from "@oxlint/plugins";

/**
 * Bans that describe the shape of the running app. Each one names the
 * replacement, since the agent writing the code cannot otherwise know it.
 */

const noRawAnchor = defineRule({
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "a") {
          context.report({ messageId: "rawAnchor", node });
        }
      },
    };
  },
  meta: {
    messages: {
      rawAnchor:
        "Raw anchor tags <a> are not allowed in the Electron app. Use the ExternalLink component instead.",
    },
    schema: [],
    type: "problem",
  },
});

const oneTooltipProvider = defineRule({
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type === "JSXIdentifier" &&
          node.name.name === "TooltipProvider"
        ) {
          context.report({ messageId: "tooltipProvider", node });
        }
      },
    };
  },
  meta: {
    messages: {
      tooltipProvider:
        "TooltipProvider should only be declared once at the app root. Do not use it in other components.",
    },
    schema: [],
    type: "problem",
  },
});

const noRouterLink = defineRule({
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@tanstack/react-router") {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "Link"
          ) {
            context.report({ messageId: "routerLink", node: specifier });
          }
        }
      },
    };
  },
  meta: {
    messages: {
      routerLink:
        "TanStack Router's Link is not tab-aware. Use the InternalLink component instead.",
    },
    schema: [],
    type: "problem",
  },
});

const transitionColors = /(?:^|\s)transition-colors(?:\s|$)/;

const noTransitionColors = defineRule({
  create(context) {
    return {
      Literal(node) {
        if (
          typeof node.value === "string" &&
          transitionColors.test(node.value)
        ) {
          context.report({ messageId: "transitionColors", node });
        }
      },
    };
  },
  meta: {
    messages: {
      transitionColors:
        "Color and background never ease: a ramp in front of hover or pressed feedback reads as lag. Drop the class so the change lands on the next paint, or name the properties that really move (transition-[transform], transition-[outline]).",
    },
    schema: [],
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "studio" },
  rules: {
    "no-raw-anchor": noRawAnchor,
    "no-router-link": noRouterLink,
    "no-transition-colors": noTransitionColors,
    "one-tooltip-provider": oneTooltipProvider,
  },
});
