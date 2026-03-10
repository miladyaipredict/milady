#!/usr/bin/env node
/**
 * Post-install patches for various @elizaos and dependency packages.
 *
 * 1) @elizaos/plugin-sql: Adds .onConflictDoNothing() to createWorld(), guards
 *    ensureEmbeddingDimension(), removes pgcrypto from extension list.
 *    Remove once plugin-sql publishes fixes.
 *
 * 2) Bun exports: Some published @elizaos packages set exports["."].bun =
 *    "./src/index.ts", which only exists in their dev workspace, not in the
 *    npm tarball. Bun picks "bun" first and fails. We remove the dead "bun"/
 *    "default" conditions so Bun resolves via "import" → dist/. WHY: See
 *    docs/plugin-resolution-and-node-path.md "Bun and published package exports".
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  patchBunExports,
  patchExtensionlessJsExports,
  patchNobleHashesCompat,
  patchProperLockfileSignalExitCompat,
} from "./lib/patch-bun-exports.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const homeDir = process.env.HOME || process.env.USERPROFILE || "";
const bunCacheBase = resolve(homeDir, ".bun/install/cache");

/**
 * Find all dist files for a given scoped package across node_modules AND
 * bun's install cache (bun resolves from ~/.bun/install/cache/, not
 * node_modules, so patches must be applied to both locations).
 */
function findAllPackageDists(packageName, distRelPaths) {
  const targets = [];
  const add = (p) => {
    if (existsSync(p) && !targets.includes(p)) targets.push(p);
  };

  // 1. Standard node_modules
  for (const dp of distRelPaths) {
    add(resolve(root, `node_modules/${packageName}/${dp}`));
  }

  // 2. Bun install cache — scoped packages stored as @scope/name@version@@@1
  //    e.g. ~/.bun/install/cache/@elizaos/core@2.0.0-hash@@@1/dist/node/index.node.js
  if (existsSync(bunCacheBase)) {
    try {
      const parts = packageName.split("/");
      const scope = parts[0]; // e.g. "@elizaos"
      const name = parts[1]; // e.g. "core"
      const scopeDir = resolve(bunCacheBase, scope);
      if (existsSync(scopeDir)) {
        const entries = readdirSync(scopeDir);
        for (const entry of entries) {
          if (entry.startsWith(name + "@")) {
            for (const dp of distRelPaths) {
              add(resolve(scopeDir, entry, dp));
            }
          }
        }
      }
    } catch {}
  }

  // 3. Bun global node_modules
  const bunGlobal = resolve(
    homeDir,
    `.bun/install/global/node_modules/${packageName}`,
  );
  if (existsSync(bunGlobal)) {
    for (const dp of distRelPaths) {
      add(resolve(bunGlobal, dp));
    }
  }

  return targets;
}

/**
 * Find ALL plugin-sql dist files - handles both npm and bun cache structures.
 * Returns array of all found paths including BOTH node and browser builds
 * (bun can have multiple copies with different hashes and might use either).
 * Also searches the eliza submodule's node_modules.
 */
function findAllPluginSqlDists() {
  const targets = [];
  const distPaths = [
    "dist/node/index.node.js",
    "dist/browser/index.browser.js",
  ];

  // Search roots: main project, eliza submodule, plugin submodules, and global node_modules
  const searchRoots = [root];
  const elizaRoot = resolve(root, "eliza");
  if (existsSync(resolve(elizaRoot, "node_modules"))) {
    searchRoots.push(elizaRoot);
  }

  // Also check global node_modules in home directory (bun may resolve from there)
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const homeNodeModules = resolve(homeDir, "node_modules");
  if (existsSync(homeNodeModules)) {
    searchRoots.push(resolve(homeNodeModules, ".."));
  }

  // Also check for plugin-sql as a local plugin submodule
  const pluginSqlRoot = resolve(root, "plugins/plugin-sql/typescript");
  if (existsSync(pluginSqlRoot)) {
    for (const distPath of distPaths) {
      const pluginTarget = resolve(pluginSqlRoot, distPath);
      if (existsSync(pluginTarget) && !targets.includes(pluginTarget)) {
        targets.push(pluginTarget);
      }
    }
  }

  for (const searchRoot of searchRoots) {
    // Standard npm location
    for (const distPath of distPaths) {
      const npmTarget = resolve(
        searchRoot,
        `node_modules/@elizaos/plugin-sql/${distPath}`,
      );
      if (existsSync(npmTarget) && !targets.includes(npmTarget)) {
        targets.push(npmTarget);
      }
    }

    // Bun cache location (node_modules/.bun/@elizaos+plugin-sql@*/...)
    // Bun can have multiple copies with different content hashes
    const bunCacheDir = resolve(searchRoot, "node_modules/.bun");
    if (existsSync(bunCacheDir)) {
      try {
        const entries = readdirSync(bunCacheDir);
        for (const entry of entries) {
          if (entry.startsWith("@elizaos+plugin-sql@")) {
            for (const distPath of distPaths) {
              const bunTarget = resolve(
                bunCacheDir,
                entry,
                `node_modules/@elizaos/plugin-sql/${distPath}`,
              );
              if (existsSync(bunTarget) && !targets.includes(bunTarget)) {
                targets.push(bunTarget);
              }
            }
          }
        }
      } catch {
        // Ignore errors reading bun cache
      }
    }
  }

  return targets;
}

const targets = findAllPluginSqlDists();

if (targets.length === 0) {
  console.log("[patch-deps] plugin-sql dist not found, skipping patch.");
  process.exit(0);
}

console.log(
  `[patch-deps] Found ${targets.length} plugin-sql dist file(s) to patch.`,
);

// Patch definitions
const createWorldBuggy = `await this.db.insert(worldTable).values({
        ...world,
        id: newWorldId,
        name: world.name || ""
      });`;

const createWorldFixed = `await this.db.insert(worldTable).values({
        ...world,
        id: newWorldId,
        name: world.name || ""
      }).onConflictDoNothing();`;

const embeddingBuggy = `this.embeddingDimension = DIMENSION_MAP[dimension];`;
const embeddingFixed = `const resolvedDimension = DIMENSION_MAP[dimension];
				if (!resolvedDimension) {
					const fallbackDimension = this.embeddingDimension ?? DIMENSION_MAP[384];
					this.embeddingDimension = fallbackDimension;
					logger10.warn(
						{
							src: "plugin:sql",
							requestedDimension: dimension,
							fallbackDimension,
						},
						"Unsupported embedding dimension requested; keeping fallback embedding column",
					);
					return;
				}
				this.embeddingDimension = resolvedDimension;`;

// Patch: Remove pgcrypto from extension list entirely
// pgcrypto is not used in the codebase and PGlite doesn't support it
// We check for multiple patterns since we may have already partially patched
const extensionsPatterns = [
  // Original unpatched code (newer format)
  `const extensions = isRealPostgres ? ["vector", "fuzzystrmatch", "pgcrypto"] : ["vector", "fuzzystrmatch"];`,
  // Previously patched with isPglite check
  `const isPglite = !!process.env.PGLITE_DATA_DIR;
      const extensions = isRealPostgres && !isPglite ? ["vector", "fuzzystrmatch", "pgcrypto"] : ["vector", "fuzzystrmatch"];`,
];
// Fixed: just never include pgcrypto - it's not used and causes PGlite warnings
const extensionsNoPgcrypto = `const extensions = ["vector", "fuzzystrmatch"];`;

// Older format: extensions passed directly to installRequiredExtensions
const extensionsInlinePatterns = [
  // Hardcoded array with pgcrypto
  `await this.extensionManager.installRequiredExtensions([
        "vector",
        "fuzzystrmatch",
        "pgcrypto"
      ]);`,
  // Single-line variant
  `await this.extensionManager.installRequiredExtensions(["vector", "fuzzystrmatch", "pgcrypto"]);`,
];
const extensionsInlineFixed = `await this.extensionManager.installRequiredExtensions([
        "vector",
        "fuzzystrmatch"
      ]);`;

// Apply patches to each found plugin-sql dist file
for (const target of targets) {
  console.log(`[patch-deps] Patching: ${target}`);
  let src = readFileSync(target, "utf8");
  let patched = 0;

  if (src.includes(createWorldFixed)) {
    console.log("  - createWorld conflict patch already present.");
  } else if (src.includes(createWorldBuggy)) {
    src = src.replace(createWorldBuggy, createWorldFixed);
    patched += 1;
    console.log("  - Applied createWorld onConflictDoNothing() patch.");
  } else {
    console.log(
      "  - createWorld() signature changed — world patch may no longer be needed.",
    );
  }

  if (src.includes(embeddingFixed)) {
    console.log("  - ensureEmbeddingDimension guard patch already present.");
  } else if (src.includes(embeddingBuggy)) {
    src = src.replace(embeddingBuggy, embeddingFixed);
    patched += 1;
    console.log("  - Applied ensureEmbeddingDimension guard patch.");
  } else {
    console.log(
      "  - ensureEmbeddingDimension signature changed — embedding patch may no longer be needed.",
    );
  }

  // Check for pgcrypto removal (const extensions = ... pattern)
  if (src.includes(extensionsNoPgcrypto)) {
    console.log("  - pgcrypto removal patch already present.");
  } else {
    let pgcryptoPatched = false;
    for (const pattern of extensionsPatterns) {
      if (src.includes(pattern)) {
        src = src.replace(pattern, extensionsNoPgcrypto);
        patched += 1;
        pgcryptoPatched = true;
        console.log("  - Removed pgcrypto from extensions list.");
        break;
      }
    }
    if (!pgcryptoPatched) {
      // Check for inline pattern (older code format)
      for (const pattern of extensionsInlinePatterns) {
        if (src.includes(pattern)) {
          src = src.replace(pattern, extensionsInlineFixed);
          patched += 1;
          pgcryptoPatched = true;
          console.log("  - Removed pgcrypto from inline extensions call.");
          break;
        }
      }
    }
    if (!pgcryptoPatched && !src.includes(extensionsInlineFixed)) {
      console.log(
        "  - Extension installation code changed — pgcrypto patch may no longer be needed.",
      );
    } else if (!pgcryptoPatched && src.includes(extensionsInlineFixed)) {
      console.log("  - pgcrypto inline removal patch already present.");
    }
  }

  // createEntities: add onConflictDoNothing() to prevent duplicate entity errors
  const createEntitiesBuggy = `await tx.insert(entityTable).values(normalizedEntities);`;
  const createEntitiesFixed = `await tx.insert(entityTable).values(normalizedEntities).onConflictDoNothing();`;
  if (src.includes(createEntitiesFixed)) {
    console.log("  - createEntities onConflictDoNothing patch already present.");
  } else if (src.includes(createEntitiesBuggy)) {
    src = src.replace(createEntitiesBuggy, createEntitiesFixed);
    patched += 1;
    console.log("  - Applied createEntities onConflictDoNothing() patch.");
  } else {
    console.log(
      "  - createEntities() signature changed — entity patch may no longer be needed.",
    );
  }

  if (patched > 0) {
    writeFileSync(target, src, "utf8");
    console.log(`  - Wrote ${patched} patch(es) to this file.`);
  } else {
    console.log("  - No patches needed for this file.");
  }
}

/**
 * Patch @elizaos/plugin-elizacloud (next tag currently points to alpha.4)
 * to avoid AI SDK warnings from unsupported params on Responses API models.
 */
const cloudTarget = resolve(
  root,
  "node_modules/@elizaos/plugin-elizacloud/dist/node/index.node.js",
);

if (!existsSync(cloudTarget)) {
  console.log("[patch-deps] plugin-elizacloud dist not found, skipping patch.");
} else {
  let cloudSrc = readFileSync(cloudTarget, "utf8");
  let cloudPatched = 0;

  const cloudBuggy = `function buildGenerateParams(runtime, modelType, params) {
  const { prompt, stopSequences = [] } = params;
  const temperature = params.temperature ?? 0.7;
  const frequencyPenalty = params.frequencyPenalty ?? 0.7;
  const presencePenalty = params.presencePenalty ?? 0.7;
  const maxTokens = params.maxTokens ?? 8192;
  const openai = createOpenAIClient(runtime);
  const modelName = modelType === ModelType4.TEXT_SMALL ? getSmallModel(runtime) : getLargeModel(runtime);
  const modelLabel = modelType === ModelType4.TEXT_SMALL ? "TEXT_SMALL" : "TEXT_LARGE";
  const experimentalTelemetry = getExperimentalTelemetry(runtime);
  const model = openai.languageModel(modelName);
  const generateParams = {
    model,
    prompt,
    system: runtime.character.system ?? undefined,
    temperature,
    maxOutputTokens: maxTokens,
    frequencyPenalty,
    presencePenalty,
    stopSequences,
    experimental_telemetry: {
      isEnabled: experimentalTelemetry
    }
  };
  return { generateParams, modelName, modelLabel, prompt };
}`;

  const cloudFixed = `function buildGenerateParams(runtime, modelType, params) {
  const { prompt } = params;
  const maxTokens = params.maxTokens ?? 8192;
  const openai = createOpenAIClient(runtime);
  const modelName = modelType === ModelType4.TEXT_SMALL ? getSmallModel(runtime) : getLargeModel(runtime);
  const modelLabel = modelType === ModelType4.TEXT_SMALL ? "TEXT_SMALL" : "TEXT_LARGE";
  const experimentalTelemetry = getExperimentalTelemetry(runtime);
  const model = openai.chat(modelName);
  const lowerModelName = modelName.toLowerCase();
  const supportsStopSequences = !lowerModelName.startsWith("openai/") && !lowerModelName.startsWith("anthropic/") && !["o1", "o3", "o4", "gpt-5", "gpt-5-mini"].some((pattern) => lowerModelName.includes(pattern));
  const stopSequences = supportsStopSequences && Array.isArray(params.stopSequences) && params.stopSequences.length > 0 ? params.stopSequences : void 0;
  const generateParams = {
    model,
    prompt,
    system: runtime.character.system ?? undefined,
    ...(stopSequences ? { stopSequences } : {}),
    maxOutputTokens: maxTokens,
    experimental_telemetry: {
      isEnabled: experimentalTelemetry
    }
  };
  return { generateParams, modelName, modelLabel, prompt };
}`;

  if (cloudSrc.includes(cloudFixed)) {
    console.log("[patch-deps] elizacloud warning patch already present.");
  } else if (cloudSrc.includes(cloudBuggy)) {
    cloudSrc = cloudSrc.replace(cloudBuggy, cloudFixed);
    cloudPatched += 1;
    console.log("[patch-deps] Applied elizacloud responses-compat patch.");
  } else {
    console.log(
      "[patch-deps] elizacloud buildGenerateParams signature changed; skip patch.",
    );
  }

  if (cloudPatched > 0) {
    writeFileSync(cloudTarget, cloudSrc, "utf8");
    console.log(
      `[patch-deps] Wrote ${cloudPatched} plugin-elizacloud patch(es).`,
    );
  }
}

/**
 * Patch @elizaos/plugin-openrouter (next tag currently points to alpha.5)
 * so unsupported sampling params are not forced for Responses-routed models.
 */
const openrouterTarget = resolve(
  root,
  "node_modules/@elizaos/plugin-openrouter/dist/node/index.node.js",
);

if (!existsSync(openrouterTarget)) {
  console.log("[patch-deps] plugin-openrouter dist not found, skipping patch.");
} else {
  let openrouterSrc = readFileSync(openrouterTarget, "utf8");
  let openrouterPatched = 0;

  const openrouterBuggy = `function buildGenerateParams(runtime, modelType, params) {
  const { prompt, stopSequences = [] } = params;
  const temperature = params.temperature ?? 0.7;
  const frequencyPenalty = params.frequencyPenalty ?? 0.7;
  const presencePenalty = params.presencePenalty ?? 0.7;
  const paramsWithMax = params;
  const resolvedMaxOutput = paramsWithMax.maxOutputTokens ?? paramsWithMax.maxTokens ?? 8192;
  const openrouter = createOpenRouterProvider(runtime);
  const modelName = modelType === ModelType4.TEXT_SMALL ? getSmallModel(runtime) : getLargeModel(runtime);
  const modelLabel = modelType === ModelType4.TEXT_SMALL ? "TEXT_SMALL" : "TEXT_LARGE";
  const generateParams = {
    model: openrouter.chat(modelName),
    prompt,
    system: runtime.character?.system ?? undefined,
    temperature,
    frequencyPenalty,
    presencePenalty,
    stopSequences,
    maxOutputTokens: resolvedMaxOutput
  };
  return { generateParams, modelName, modelLabel, prompt };
}`;

  const openrouterFixed = `function buildGenerateParams(runtime, modelType, params) {
  const { prompt } = params;
  const temperature = params.temperature ?? 0.7;
  const frequencyPenalty = params.frequencyPenalty ?? 0.7;
  const presencePenalty = params.presencePenalty ?? 0.7;
  const paramsWithMax = params;
  const resolvedMaxOutput = paramsWithMax.maxOutputTokens ?? paramsWithMax.maxTokens ?? 8192;
  const openrouter = createOpenRouterProvider(runtime);
  const modelName = modelType === ModelType4.TEXT_SMALL ? getSmallModel(runtime) : getLargeModel(runtime);
  const modelLabel = modelType === ModelType4.TEXT_SMALL ? "TEXT_SMALL" : "TEXT_LARGE";
  const lowerModelName = modelName.toLowerCase();
  const supportsSampling = !lowerModelName.startsWith("openai/") && !lowerModelName.startsWith("anthropic/") && !["o1", "o3", "o4", "gpt-5", "gpt-5-mini"].some((pattern) => lowerModelName.includes(pattern));
  const stopSequences = supportsSampling && Array.isArray(params.stopSequences) && params.stopSequences.length > 0 ? params.stopSequences : void 0;
  const generateParams = {
    model: openrouter.chat(modelName),
    prompt,
    system: runtime.character?.system ?? undefined,
    ...(supportsSampling ? {
      temperature,
      frequencyPenalty,
      presencePenalty,
      ...(stopSequences ? {
        stopSequences
      } : {})
    } : {}),
    maxOutputTokens: resolvedMaxOutput
  };
  return { generateParams, modelName, modelLabel, prompt };
}`;

  if (openrouterSrc.includes(openrouterFixed)) {
    console.log("[patch-deps] openrouter sampling patch already present.");
  } else if (openrouterSrc.includes(openrouterBuggy)) {
    openrouterSrc = openrouterSrc.replace(openrouterBuggy, openrouterFixed);
    openrouterPatched += 1;
    console.log("[patch-deps] Applied openrouter sampling-compat patch.");
  } else {
    console.log(
      "[patch-deps] openrouter buildGenerateParams signature changed; skip patch.",
    );
  }

  if (openrouterPatched > 0) {
    writeFileSync(openrouterTarget, openrouterSrc, "utf8");
    console.log(
      `[patch-deps] Wrote ${openrouterPatched} plugin-openrouter patch(es).`,
    );
  }
}

/**
 * Patch @elizaos/plugin-twitter POST_TWEET action to upload image attachments.
 *
 * The action handler only passes text to sendTweet(), ignoring any
 * message.content.attachments (e.g. images sent from the chat UI).
 * This patch reads image data from the non-standard `_data`/`_mimeType` fields
 * that Milady sets on attachments (keeping the `url` field compact to avoid
 * bloating the LLM context window with base64 strings).
 *
 * Remove once plugin-twitter ships native attachment support.
 */
const twitterTarget = resolve(
  root,
  "node_modules/@elizaos/plugin-twitter/dist/index.js",
);

if (!existsSync(twitterTarget)) {
  console.log("[patch-deps] plugin-twitter dist not found, skipping patch.");
} else {
  let twitterSrc = readFileSync(twitterTarget, "utf8");

  // Original unpatched code.
  const twitterBuggy = `      const result = await client.twitterClient.sendTweet(finalTweetText);`;

  // v1 patch (url-based — reads base64 from att.url, may already be applied).
  const twitterV1Fixed = `      // Upload any image attachments from the user's chat message
      const imageAttachments = message.content?.attachments?.filter(
        (att) => att.contentType === "image" || (att.url && att.url.startsWith("data:image/"))
      ) ?? [];
      const tweetMediaIds = [];
      for (const att of imageAttachments) {
        try {
          const dataUrl = att.url ?? "";
          const commaIdx = dataUrl.indexOf(",");
          if (commaIdx === -1) continue;
          const base64Data = dataUrl.slice(commaIdx + 1);
          const mimeMatch = dataUrl.match(/^data:([^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
          const buffer = Buffer.from(base64Data, "base64");
          const mediaId = await client.twitterClient.uploadMedia(buffer, { mimeType });
          tweetMediaIds.push(mediaId);
        } catch (mediaErr) {
          logger14.warn("Failed to upload tweet media attachment:", mediaErr);
        }
      }
      const result = await client.twitterClient.sendTweet(
        finalTweetText,
        void 0,
        void 0,
        void 0,
        tweetMediaIds.length > 0 ? tweetMediaIds : void 0
      );`;

  // v2 patch — reads base64 from att._data/_mimeType so the url field stays
  // compact (attachment:img-0) and doesn't consume LLM context tokens.
  const twitterFixed = `      // Upload any image attachments from the user's chat message
      const imageAttachments = message.content?.attachments?.filter(
        (att) => att.contentType === "image" && (att._data || (att.url && att.url.startsWith("data:image/")))
      ) ?? [];
      const tweetMediaIds = [];
      for (const att of imageAttachments) {
        try {
          let base64Data, mimeType;
          if (att._data) {
            base64Data = att._data;
            mimeType = att._mimeType || "image/jpeg";
          } else {
            const dataUrl = att.url ?? "";
            const commaIdx = dataUrl.indexOf(",");
            if (commaIdx === -1) continue;
            base64Data = dataUrl.slice(commaIdx + 1);
            const mimeMatch = dataUrl.match(/^data:([^;]+);/);
            mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
          }
          const buffer = Buffer.from(base64Data, "base64");
          const mediaId = await client.twitterClient.uploadMedia(buffer, { mimeType });
          tweetMediaIds.push(mediaId);
        } catch (mediaErr) {
          logger14.warn("Failed to upload tweet media attachment:", mediaErr);
        }
      }
      const result = await client.twitterClient.sendTweet(
        finalTweetText,
        void 0,
        void 0,
        void 0,
        tweetMediaIds.length > 0 ? tweetMediaIds : void 0
      );`;

  // v2 is uniquely identified by reading from att._data (not att.url)
  const twitterV2Marker = `if (att._data) {`;
  if (twitterSrc.includes(twitterV2Marker)) {
    console.log(
      "[patch-deps] twitter POST_TWEET media patch (v2) already present.",
    );
  } else if (twitterSrc.includes(twitterV1Fixed.slice(0, 80))) {
    twitterSrc = twitterSrc.replace(twitterV1Fixed, twitterFixed);
    writeFileSync(twitterTarget, twitterSrc, "utf8");
    console.log("[patch-deps] Upgraded twitter POST_TWEET media patch to v2.");
  } else if (twitterSrc.includes(twitterBuggy)) {
    twitterSrc = twitterSrc.replace(twitterBuggy, twitterFixed);
    writeFileSync(twitterTarget, twitterSrc, "utf8");
    console.log(
      "[patch-deps] Applied twitter POST_TWEET media upload patch (v2).",
    );
  } else {
    console.log(
      "[patch-deps] twitter POST_TWEET sendTweet call changed — media patch may no longer be needed.",
    );
  }
}

/**
 * Patch @elizaos/plugin-pdf to fix ESM compatibility with pdfjs-dist.
 *
 * pdfjs-dist doesn't provide a default export in ESM mode, so
 * `import pkg from "pdfjs-dist"` fails. We patch it to use namespace import,
 * and force the Node build onto the legacy entry so browser globals like
 * DOMMatrix are not required in the packaged backend runtime.
 *
 * Remove once plugin-pdf publishes a fix for ESM compatibility.
 */
function findAllPluginPdfDists() {
  const targets = [];
  const distPaths = [
    "dist/node/index.node.js",
    "dist/browser/index.browser.js",
  ];

  const searchRoots = [root];
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const homeNodeModules = resolve(homeDir, "node_modules");
  if (existsSync(homeNodeModules)) {
    searchRoots.push(resolve(homeNodeModules, ".."));
  }

  for (const searchRoot of searchRoots) {
    for (const distPath of distPaths) {
      const npmTarget = resolve(
        searchRoot,
        `node_modules/@elizaos/plugin-pdf/${distPath}`,
      );
      if (existsSync(npmTarget) && !targets.includes(npmTarget)) {
        targets.push(npmTarget);
      }
    }

    const bunCacheDir = resolve(searchRoot, "node_modules/.bun");
    if (existsSync(bunCacheDir)) {
      try {
        const entries = readdirSync(bunCacheDir);
        for (const entry of entries) {
          if (entry.startsWith("@elizaos+plugin-pdf@")) {
            for (const distPath of distPaths) {
              const bunTarget = resolve(
                bunCacheDir,
                entry,
                `node_modules/@elizaos/plugin-pdf/${distPath}`,
              );
              if (existsSync(bunTarget) && !targets.includes(bunTarget)) {
                targets.push(bunTarget);
              }
            }
          }
        }
      } catch {
        // Ignore errors reading bun cache
      }
    }
  }

  return targets;
}

const pdfTargets = findAllPluginPdfDists();

if (pdfTargets.length === 0) {
  console.log("[patch-deps] plugin-pdf dist not found, skipping patch.");
} else {
  console.log(
    `[patch-deps] Found ${pdfTargets.length} plugin-pdf dist file(s) to patch.`,
  );

  // Use regex to match various minified patterns of the default import
  // Pattern: import <var> from "pdfjs-dist" or import <var> from"pdfjs-dist"
  const pdfBuggyImportRegex = /import\s+(\w+)\s+from\s*"pdfjs-dist"/g;
  const pdfNodeImportRegex = /from\s*"pdfjs-dist"/g;
  // Use .js instead of .mjs — bun's cache extraction consistently skips .mjs files
  const pdfLegacySpecifier = 'from "pdfjs-dist/legacy/build/pdf.js"';

  for (const target of pdfTargets) {
    console.log(`[patch-deps] Patching plugin-pdf: ${target}`);
    let src = readFileSync(target, "utf8");
    let patched = false;

    if (src.includes("import * as") && src.includes("pdfjs-dist")) {
      console.log("  - pdfjs-dist ESM import patch already present.");
    } else {
      // Find all default imports from pdfjs-dist and replace with namespace imports
      const matches = [...src.matchAll(pdfBuggyImportRegex)];
      if (matches.length > 0) {
        for (const match of matches) {
          const varName = match[1];
          const originalImport = match[0];
          const fixedImport = `import * as ${varName} from "pdfjs-dist"`;
          src = src.replace(originalImport, fixedImport);
          patched = true;
        }
        if (patched) {
          console.log(
            `  - Applied pdfjs-dist ESM namespace import patch (${matches.length} occurrence(s)).`,
          );
        }
      } else if (src.includes("pdfjs-dist")) {
        console.log(
          "  - pdfjs-dist import pattern changed — patch may need updating.",
        );
      } else {
        console.log(
          "  - pdfjs-dist import not found — patch may no longer be needed.",
        );
      }
    }

    if (target.includes("/dist/node/")) {
      if (src.includes(pdfLegacySpecifier)) {
        console.log("  - pdfjs-dist legacy Node import patch already present.");
      } else if (src.includes('from "pdfjs-dist"')) {
        src = src.replace(pdfNodeImportRegex, pdfLegacySpecifier);
        patched = true;
        console.log(
          "  - Redirected plugin-pdf Node build to pdfjs-dist legacy entry.",
        );
      }
    }

    if (patched) {
      writeFileSync(target, src, "utf8");
      console.log("  - Wrote pdfjs-dist ESM patch.");
    }
  }
}

// ---------------------------------------------------------------------------
// Patch @elizaos packages whose exports["."].bun points to ./src/index.ts.
// Logic lives in scripts/lib/patch-bun-exports.mjs (testable).
// ---------------------------------------------------------------------------
/**
 * Patch @elizaos/plugin-polymarket to handle removed validateActionRegex/
 * validateActionKeywords exports from @elizaos/core alpha.12+.
 *
 * The plugin was built against core alpha.7 which had these exports.
 * We replace the import and usage with no-op stubs so the plugin loads.
 * Remove once plugin-polymarket publishes a version compatible with core alpha.12+.
 */
const polymarketTargets = findAllPackageDists("@elizaos/plugin-polymarket", [
  "dist/index.js",
]);

if (polymarketTargets.length === 0) {
  console.log("[patch-deps] plugin-polymarket dist not found, skipping patch.");
}

for (const polymarketTarget of polymarketTargets) {
  console.log(`[patch-deps] Patching polymarket: ${polymarketTarget}`);
  let polymarketSrc = readFileSync(polymarketTarget, "utf8");
  let polymarketPatched = 0;

  const polymarketBuggyImport = `import { logger as logger3, validateActionKeywords, validateActionRegex } from "@elizaos/core";`;
  const polymarketFixedImport = `import { logger as logger3 } from "@elizaos/core";
const validateActionKeywords = () => true;
const validateActionRegex = () => true;`;

  if (polymarketSrc.includes("const validateActionKeywords = () => true")) {
    console.log(
      "[patch-deps] polymarket validateAction patch already present.",
    );
  } else if (polymarketSrc.includes(polymarketBuggyImport)) {
    polymarketSrc = polymarketSrc.replace(
      polymarketBuggyImport,
      polymarketFixedImport,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket validateAction stub patch.");
  } else {
    console.log(
      "[patch-deps] polymarket import pattern changed — patch may no longer be needed.",
    );
  }

  // Patch: initializeClobClientWithCreds should inherit proxy wallet settings
  // from the PolymarketService instead of requiring separate env vars.
  // Without this, orders are submitted with signatureType=0 (EOA) instead of
  // signatureType=1 (POLY_PROXY), causing "invalid signature" from the CLOB API.
  const clobClientBuggy = `  const signatureType = parseSignatureType(signatureTypeSetting);
  const funderAddress = normalizeSetting(funderSetting);
  const client = new ClobClient(clobApiUrl, POLYGON_CHAIN_ID, signer, creds, signatureType, funderAddress);
  return client;
}`;

  const clobClientFixed = `  let signatureType = parseSignatureType(signatureTypeSetting);
  let funderAddress = normalizeSetting(funderSetting);
  // Auto-inherit proxy wallet settings from PolymarketService if not set via env
  if (!funderAddress) {
    try {
      const service = await getPolymarketService(runtime);
      if (service?.authenticatedClient) {
        const svcFunder = service.authenticatedClient.funderAddress;
        const svcSigType = service.authenticatedClient.signatureType;
        if (svcFunder) {
          funderAddress = svcFunder;
          signatureType = svcSigType ?? 1;
          runtime.logger?.info?.("[initializeClobClientWithCreds] Inherited proxy wallet from service: " + funderAddress);
        }
      }
    } catch {}
  }
  const client = new ClobClient(clobApiUrl, POLYGON_CHAIN_ID, signer, creds, signatureType, funderAddress);
  return client;
}`;

  if (polymarketSrc.includes("Inherited proxy wallet from service")) {
    console.log(
      "[patch-deps] polymarket proxy-wallet inheritance patch already present.",
    );
  } else if (polymarketSrc.includes(clobClientBuggy)) {
    polymarketSrc = polymarketSrc.replace(clobClientBuggy, clobClientFixed);
    polymarketPatched += 1;
    console.log(
      "[patch-deps] Applied polymarket proxy-wallet inheritance patch.",
    );
  } else {
    console.log(
      "[patch-deps] polymarket initializeClobClientWithCreds signature changed; skip patch.",
    );
  }

  // Patch: ethers v6 removed Wallet._signTypedData (renamed to .signTypedData).
  // @polymarket/clob-client v5.7 checks for _signTypedData to detect ethers signers.
  // Without this alias, the signer falls through to the viem path and fails with
  // "wallet client is missing account address", producing "invalid signature" (400).
  const signerBuggy = `function createClobClientSigner(privateKey) {
  return new import_wallet.Wallet(privateKey);
}`;
  const signerFixed = `function createClobClientSigner(privateKey) {
  const w = new import_wallet.Wallet(privateKey);
  // ethers v6 compat: alias signTypedData -> _signTypedData for clob-client
  if (typeof w._signTypedData !== "function" && typeof w.signTypedData === "function") {
    w._signTypedData = w.signTypedData.bind(w);
  }
  return w;
}`;

  // Also patch the second copy (PolymarketService uses createClobClientSigner2)
  const signer2Buggy = `function createClobClientSigner2(privateKey) {
  return new import_wallet2.Wallet(privateKey);
}`;
  const signer2Fixed = `function createClobClientSigner2(privateKey) {
  const w = new import_wallet2.Wallet(privateKey);
  if (typeof w._signTypedData !== "function" && typeof w.signTypedData === "function") {
    w._signTypedData = w.signTypedData.bind(w);
  }
  return w;
}`;

  if (polymarketSrc.includes("ethers v6 compat")) {
    console.log(
      "[patch-deps] polymarket ethers v6 signer compat already present.",
    );
  } else if (polymarketSrc.includes(signerBuggy)) {
    polymarketSrc = polymarketSrc.replace(signerBuggy, signerFixed);
    if (polymarketSrc.includes(signer2Buggy)) {
      polymarketSrc = polymarketSrc.replace(signer2Buggy, signer2Fixed);
    }
    polymarketPatched += 1;
    console.log(
      "[patch-deps] Applied polymarket ethers v6 signer compat patch.",
    );
  } else {
    console.log(
      "[patch-deps] polymarket createClobClientSigner changed; skip ethers v6 patch.",
    );
  }

  // Patch: Expand placeOrder action keywords so it triggers on natural
  // trading phrases like "buy", "sell", "bet", "trade", "fire", "execute"
  // instead of only matching "polymarket", "place", "order".
  const narrowKeywords = `const __avKeywords = ["polymarket", "place", "order"];`;
  const expandedKeywords = `const __avKeywords = ["polymarket", "place", "order", "buy", "sell", "bet", "trade", "fire", "execute", "wager", "market"];`;

  const narrowRegex = `const __avRegex = /\\b(?:polymarket|place|order)\\b/i;`;
  const expandedRegex = `const __avRegex = /\\b(?:polymarket|place|order|buy|sell|bet|trade|fire|execute|wager|market)\\b/i;`;

  if (polymarketSrc.includes(expandedKeywords)) {
    console.log(
      "[patch-deps] polymarket placeOrder keyword expansion already present.",
    );
  } else if (polymarketSrc.includes(narrowKeywords)) {
    polymarketSrc = polymarketSrc.replace(narrowKeywords, expandedKeywords);
    polymarketSrc = polymarketSrc.replace(narrowRegex, expandedRegex);
    polymarketPatched += 1;
    console.log(
      "[patch-deps] Applied polymarket placeOrder keyword expansion patch.",
    );
  } else {
    console.log(
      "[patch-deps] polymarket placeOrder keywords changed; skip patch.",
    );
  }

  // Patch: Fix placeOrderAction price handling — add debug logging and robust
  // fallbacks so price never stays 0/NaN. Also treat non-0x non-MARKET_NAME_LOOKUP
  // tokenIds as market name lookups (LLM sometimes returns random strings).
  const priceHandlerBuggy = `    let tokenId = llmResult?.tokenId ?? "";
    let side = llmResult?.side?.toUpperCase() ?? "BUY";
    let price = llmResult?.price ?? 0;
    let orderType = llmResult?.orderType?.toUpperCase() ?? "GTC";
    const feeRateBps = llmResult?.feeRateBps ?? "0";
    const marketName = llmResult?.marketName;
    const outcome = llmResult?.outcome;`;

  const priceHandlerFixed = `    let tokenId = llmResult?.tokenId ?? "";
    let side = llmResult?.side?.toUpperCase() ?? "BUY";
    let price = Number(llmResult?.price) || 0;
    let orderType = llmResult?.orderType?.toUpperCase() ?? "GTC";
    const feeRateBps = llmResult?.feeRateBps ?? "0";
    let marketName = llmResult?.marketName;
    const outcome = llmResult?.outcome;
    runtime.logger.info("[placeOrderAction] LLM extracted: " + JSON.stringify({ tokenId, side, price, orderType, marketName, outcome, dollarAmount: llmResult?.dollarAmount, shares: llmResult?.shares }));
    // If tokenId is not a valid 0x condition ID and not MARKET_NAME_LOOKUP,
    // treat it as a market name search instead (LLM sometimes returns garbage)
    if (tokenId && tokenId !== "MARKET_NAME_LOOKUP" && !tokenId.startsWith("0x") && marketName) {
      runtime.logger.info("[placeOrderAction] tokenId '" + tokenId + "' is not 0x/MARKET_NAME_LOOKUP, falling back to marketName search");
      tokenId = "MARKET_NAME_LOOKUP";
    }
    if (!tokenId && marketName) {
      tokenId = "MARKET_NAME_LOOKUP";
    }`;

  if (polymarketSrc.includes("[placeOrderAction] LLM extracted")) {
    console.log(
      "[patch-deps] polymarket placeOrder price-fix patch already present.",
    );
  } else if (polymarketSrc.includes(priceHandlerBuggy)) {
    polymarketSrc = polymarketSrc.replace(priceHandlerBuggy, priceHandlerFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket placeOrder price-fix patch.");
  } else {
    console.log(
      "[patch-deps] polymarket placeOrder handler changed; skip price-fix patch.",
    );
  }

  // Patch: After order book lookup, ensure price is a valid finite number and
  // provide better fallback. Also log at each price decision point.
  const priceValidationBuggy = `    price = Math.round(price * 100) / 100;
    if (price <= 0 || price >= 1) {
      await sendError(callback, \`Invalid price: $\${price}. Price must be between $0.01 and $0.99.\`);
      return { success: false, text: \`Invalid price: \${price}\`, error: "invalid_price" };
    }`;

  const priceValidationFixed = `    // Ensure price is a finite number before rounding
    if (!Number.isFinite(price) || price <= 0) {
      runtime.logger.warn("[placeOrderAction] Price invalid before rounding: " + price + ", defaulting to 0.50");
      price = 0.5;
    }
    price = Math.round(price * 100) / 100;
    runtime.logger.info("[placeOrderAction] Final price after rounding: " + price);
    if (price <= 0 || price >= 1) {
      await sendError(callback, \`Invalid price: $\${price}. Price must be between $0.01 and $0.99.\`);
      return { success: false, text: \`Invalid price: \${price}\`, error: "invalid_price" };
    }`;

  if (polymarketSrc.includes("Price invalid before rounding")) {
    console.log(
      "[patch-deps] polymarket placeOrder price-validation patch already present.",
    );
  } else if (polymarketSrc.includes(priceValidationBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      priceValidationBuggy,
      priceValidationFixed,
    );
    polymarketPatched += 1;
    console.log(
      "[patch-deps] Applied polymarket placeOrder price-validation patch.",
    );
  } else {
    console.log(
      "[patch-deps] polymarket placeOrder price validation changed; skip patch.",
    );
  }

  // Patch: When side=SELL and size=0 (user said "close all" / "sell all"),
  // look up the current position size from PolymarketService cached state.
  const sellSizeBuggy = `    if (size <= 0) {
      await sendError(callback, "Invalid order size", "Please specify how many shares or dollars to bet");
      return { success: false, text: "Invalid order size", error: "invalid_size" };
    }`;

  const sellSizeFixed = `    if (size <= 0 && side === "SELL") {
      // Auto-detect position size for "close all" / "sell all" commands
      try {
        const pmService = runtime.getService("polymarket");
        const accountState = pmService?.getCachedAccountState?.();
        if (accountState?.positions?.length) {
          // First try exact token match
          for (const pos of accountState.positions) {
            if (pos.asset_id === tokenId || pos.assetId === tokenId) {
              const posSize = Math.abs(parseFloat(pos.size));
              if (posSize > 0) {
                size = posSize;
                runtime.logger.info("[placeOrderAction] Auto-detected position size for sell: " + size + " shares (token: " + tokenId.slice(0, 16) + "...)");
                break;
              }
            }
          }
          // If no exact match, try matching by market (condition_id) and pick
          // the position with the largest absolute size — the user might hold
          // the opposite outcome token from what the search resolved to.
          if (size <= 0) {
            for (const pos of accountState.positions) {
              const posSize = Math.abs(parseFloat(pos.size));
              if (posSize > 0 && pos.market) {
                // Check if our tokenId starts with the same prefix as any position token
                // or if they share the same market condition_id
                const posToken = pos.asset_id || pos.assetId || "";
                if (posToken && posSize > size) {
                  // Try CLOB balance for this position's token to confirm it's real
                  try {
                    const authClient = pmService?.getAuthenticatedClient?.();
                    if (authClient) {
                      const balResp = await authClient.getBalanceAllowance({ asset_type: "CONDITIONAL", token_id: posToken });
                      const bal = parseFloat(balResp?.balance ?? "0");
                      if (bal > 0) {
                        const confirmedSize = bal < 1000 ? bal : bal / 1e6;
                        if (confirmedSize > 0) {
                          size = Math.floor(confirmedSize);
                          tokenId = posToken;
                          runtime.logger.info("[placeOrderAction] Matched position by market scan: " + size + " shares (switched to token: " + posToken.slice(0, 16) + "...)");
                        }
                      }
                    }
                  } catch {}
                }
              }
            }
          }
        }
        // Also try conditional token balance from CLOB API for the original tokenId
        if (size <= 0 && tokenId) {
          try {
            const authClient = pmService?.getAuthenticatedClient?.();
            if (authClient) {
              const balResp = await authClient.getBalanceAllowance({ asset_type: "CONDITIONAL", token_id: tokenId });
              const bal = parseFloat(balResp?.balance ?? "0");
              if (bal > 0) {
                // CLOB returns raw micro-unit balance (6 decimals for conditional tokens)
                size = bal < 1000 ? Math.floor(bal) : Math.floor(bal / 1e6);
                runtime.logger.info("[placeOrderAction] Got balance from CLOB for sell: " + size + " shares (raw=" + bal + ")");
              }
            }
          } catch (balErr) {
            runtime.logger.warn("[placeOrderAction] Could not fetch token balance: " + (balErr?.message || balErr));
          }
        }
      } catch (svcErr) {
        runtime.logger.warn("[placeOrderAction] Could not auto-detect position size: " + (svcErr?.message || svcErr));
      }
    }
    if (size <= 0) {
      await sendError(callback, "Invalid order size", "Please specify how many shares or dollars to bet");
      return { success: false, text: "Invalid order size", error: "invalid_size" };
    }`;

  if (polymarketSrc.includes("Matched position by market scan")) {
    console.log(
      "[patch-deps] polymarket sell-size auto-detect patch (v3 with market scan) already present.",
    );
  } else if (polymarketSrc.includes("Auto-detected position size for sell")) {
    // Old patch present (v1 or v2) — replace the entire sell-size block
    // Find the old patch boundaries and replace with the new version
    const oldStart = polymarketSrc.indexOf("if (size <= 0 && side === \"SELL\") {");
    const oldEnd = polymarketSrc.indexOf("if (size <= 0) {\n      await sendError(callback, \"Invalid order size\"");
    if (oldStart !== -1 && oldEnd !== -1) {
      const newBlock = sellSizeFixed.split("if (size <= 0) {\n      await sendError")[0];
      polymarketSrc = polymarketSrc.substring(0, oldStart) + newBlock + polymarketSrc.substring(oldEnd);
      polymarketPatched += 1;
      console.log("[patch-deps] Upgraded polymarket sell-size patch to v3 (market scan fallback).");
    } else {
      console.log("[patch-deps] Could not find sell-size patch boundaries for upgrade.");
    }
  } else if (polymarketSrc.includes(sellSizeBuggy)) {
    polymarketSrc = polymarketSrc.replace(sellSizeBuggy, sellSizeFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket sell-size auto-detect patch.");
  } else {
    console.log(
      "[patch-deps] polymarket size validation changed; skip sell-size patch.",
    );
  }

  // Patch: Before placing a SELL order:
  // 1. Refresh the server's view of onchain balances (updateBalanceAllowance)
  // 2. Cancel any existing open orders on the same token (to free locked balance)
  // 3. Force FAK order type so it fills at market and doesn't leave resting orders
  const sellAllowanceBuggy = `    runtime.logger.info(\`[placeOrderAction] Submitting order: tokenID=\${tokenId.slice(0, 20)}..., \` + \`side=\${side}, price=\${price}, size=\${size}, orderType=\${orderType}\`);`;

  const sellAllowanceFixed = `    // For SELL orders: refresh balance and cancel conflicting orders
    if (side === "SELL") {
      try {
        runtime.logger.info("[placeOrderAction] Preparing SELL: refreshing balance + cancelling open orders on token...");
        await client.updateBalanceAllowance({ asset_type: "CONDITIONAL", token_id: tokenId });
        // Cancel any open orders on this token to free up locked balance
        try {
          const openOrders = await client.getOpenOrders();
          const tokenOrders = (openOrders?.data || openOrders || []).filter(o => o.asset_id === tokenId || o.token_id === tokenId);
          if (tokenOrders.length > 0) {
            const orderIds = tokenOrders.map(o => o.id).filter(Boolean);
            if (orderIds.length > 0) {
              await client.cancelOrders(orderIds);
              runtime.logger.info("[placeOrderAction] Cancelled " + orderIds.length + " existing orders on token before sell");
            }
          }
        } catch (cancelErr) {
          runtime.logger.warn("[placeOrderAction] Could not cancel existing orders: " + (cancelErr?.message || cancelErr));
        }
      } catch (sellPrepErr) {
        runtime.logger.warn("[placeOrderAction] SELL prep failed (continuing): " + (sellPrepErr?.message || sellPrepErr));
      }
    }
    runtime.logger.info(\`[placeOrderAction] Submitting order: tokenID=\${tokenId.slice(0, 20)}..., \` + \`side=\${side}, price=\${price}, size=\${size}, orderType=\${orderType}\`);`;

  if (polymarketSrc.includes("Preparing SELL: refreshing balance") && !polymarketSrc.includes("Switched SELL order from GTC to FAK")) {
    console.log("[patch-deps] polymarket sell-prep patch (v2, no FAK) already present.");
  } else if (polymarketSrc.includes("Switched SELL order from GTC to FAK")) {
    // Remove the FAK forcing — it breaks on illiquid markets
    polymarketSrc = polymarketSrc.replace(
      `        // Force FAK for sell-all so it fills immediately at best bid
        if (orderType === "GTC") {
          orderType = "FAK";
          runtime.logger.info("[placeOrderAction] Switched SELL order from GTC to FAK for immediate fill");
        }
`,
      "",
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Removed FAK forcing from polymarket sell-prep patch (breaks on illiquid markets).");
  } else if (
    polymarketSrc.includes("Setting conditional token allowance for SELL")
  ) {
    // Replace the old allowance-only patch with the new comprehensive one
    const oldPatch = polymarketSrc.indexOf(
      "// For SELL orders, ensure conditional token allowance is set",
    );
    const oldPatchEnd = polymarketSrc.indexOf(
      "runtime.logger.info(`[placeOrderAction] Submitting order:",
    );
    if (oldPatch !== -1 && oldPatchEnd !== -1) {
      polymarketSrc =
        polymarketSrc.substring(0, oldPatch) +
        sellAllowanceFixed.split(
          "runtime.logger.info(`[placeOrderAction] Submitting order:",
        )[0] +
        polymarketSrc.substring(oldPatchEnd);
      polymarketPatched += 1;
      console.log(
        "[patch-deps] Upgraded polymarket sell-allowance → sell-prep patch.",
      );
    }
  } else if (polymarketSrc.includes(sellAllowanceBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      sellAllowanceBuggy,
      sellAllowanceFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket sell-prep patch.");
  } else {
    console.log(
      "[patch-deps] polymarket order submission log changed; skip sell-prep patch.",
    );
  }

  // Patch: align websocket handling with Polymarket's current market/user
  // channel contract. The upstream helper still models stale channel names
  // (book/price/trade/ticker), derives websocket URLs from CLOB_API_URL, uses
  // subscribe payloads with channel/assets_ids, and sends ws ping frames. The
  // current docs use separate /ws/market and /ws/user endpoints, market/user
  // handshake payloads, operation-based follow-up messages, and "PING" heartbeats.
  const websocketChannelsBuggy = `  normalizeChannel(channel) {
    const normalized = channel.trim().toLowerCase();
    switch (normalized) {
      case "book":
      case "price":
      case "trade":
      case "ticker":
      case "user":
        return normalized;
      default:
        return null;
    }
  }
  normalizeChannels(channels) {
    const defaults = ["book", "price"];
    if (!channels || channels.length === 0) {
      return defaults;
    }
    const parsed = [];
    channels.forEach((channel) => {
      const normalized = this.normalizeChannel(channel);
      if (normalized) {
        parsed.push(normalized);
      }
    });
    return parsed.length > 0 ? parsed : defaults;
  }`;

  const websocketChannelsFixed = `  normalizeChannel(channel) {
    const normalized = channel.trim().toLowerCase();
    switch (normalized) {
      case "book":
      case "price":
      case "trade":
      case "ticker":
      case "market":
        return "market";
      case "user":
        return "user";
      default:
        return null;
    }
  }
  normalizeChannels(channels) {
    const defaults = ["market"];
    if (!channels || channels.length === 0) {
      return defaults;
    }
    const parsed = [];
    channels.forEach((channel) => {
      const normalized = this.normalizeChannel(channel);
      if (normalized && !parsed.includes(normalized)) {
        parsed.push(normalized);
      }
    });
    return parsed.length > 0 ? parsed : defaults;
  }`;

  if (polymarketSrc.includes(`const defaults = ["market"];`)) {
    console.log(
      "[patch-deps] polymarket websocket channel patch already present.",
    );
  } else if (polymarketSrc.includes(websocketChannelsBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketChannelsBuggy,
      websocketChannelsFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket channel patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket channel helpers changed; skip patch.",
    );
  }

  const websocketUrlBuggy = `  resolveWebsocketUrl() {
    const wsSetting = this.polymarketRuntime.getSetting("CLOB_WS_URL") || this.polymarketRuntime.getSetting("CLOB_API_URL") || DEFAULT_CLOB_WS_URL;
    const wsUrl = String(wsSetting);
    if (wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://")) {
      return wsUrl;
    }
    if (wsUrl.startsWith("http://")) {
      return wsUrl.replace("http://", "ws://");
    }
    if (wsUrl.startsWith("https://")) {
      return wsUrl.replace("https://", "wss://");
    }
    return \`wss://\${wsUrl}\`;
  }
  getSubscriptionKey(channel, assetIds, authenticated) {`;

  const websocketUrlFixed = `  resolveWebsocketBaseUrl() {
    const wsSetting = this.polymarketRuntime.getSetting("CLOB_WS_URL") || DEFAULT_CLOB_WS_URL;
    let wsUrl = String(wsSetting).trim();
    if (wsUrl.startsWith("http://")) {
      wsUrl = wsUrl.replace("http://", "ws://");
    } else if (wsUrl.startsWith("https://")) {
      wsUrl = wsUrl.replace("https://", "wss://");
    } else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
      wsUrl = \`wss://\${wsUrl}\`;
    }
    if (wsUrl.endsWith("/market")) {
      wsUrl = wsUrl.slice(0, -"/market".length);
    } else if (wsUrl.endsWith("/user")) {
      wsUrl = wsUrl.slice(0, -"/user".length);
    }
    if (wsUrl.endsWith("/ws")) {
      return \`\${wsUrl}/\`;
    }
    if (wsUrl.endsWith("/ws/")) {
      return wsUrl;
    }
    return \`\${wsUrl.replace(/\\/+$/, "")}/ws/\`;
  }
  resolveWebsocketUrl(channel) {
    const targetChannel = channel === "user" ? "user" : "market";
    return \`\${this.resolveWebsocketBaseUrl()}\${targetChannel}\`;
  }
  getWebsocketAuth() {
    const apiKey = normalizeSetting2(this.polymarketRuntime.getSetting("CLOB_API_KEY"));
    const apiSecret = normalizeSetting2(this.polymarketRuntime.getSetting("CLOB_API_SECRET")) || normalizeSetting2(this.polymarketRuntime.getSetting("CLOB_SECRET"));
    const apiPassphrase = normalizeSetting2(this.polymarketRuntime.getSetting("CLOB_API_PASSPHRASE")) || normalizeSetting2(this.polymarketRuntime.getSetting("CLOB_PASS_PHRASE"));
    if (!apiKey || !apiSecret || !apiPassphrase) {
      throw new Error("Authenticated websocket requires CLOB API credentials.");
    }
    return {
      apiKey,
      secret: apiSecret,
      passphrase: apiPassphrase
    };
  }
  buildWebsocketMessage(channel, assetIds, authenticated, operation) {
    if (channel === "user") {
      const message = operation ? { operation } : { type: "user" };
      if (authenticated) {
        message.auth = this.getWebsocketAuth();
      }
      if (assetIds.length > 0) {
        message.markets = assetIds;
      }
      return {
        _channel: channel,
        _authenticated: authenticated,
        ...message
      };
    }
    const message = operation ? {
      operation,
      assets_ids: assetIds,
      custom_feature_enabled: true
    } : {
      type: "market",
      assets_ids: assetIds,
      custom_feature_enabled: true
    };
    return {
      _channel: channel,
      _authenticated: false,
      ...message
    };
  }
  extractWebsocketIds(message) {
    if (Array.isArray(message.assets_ids)) {
      return message.assets_ids;
    }
    if (Array.isArray(message.markets)) {
      return message.markets;
    }
    return [];
  }
  getSubscriptionKey(channel, assetIds, authenticated) {`;

  if (
    polymarketSrc.includes(
      "buildWebsocketMessage(channel, assetIds, authenticated, operation)",
    )
  ) {
    console.log(
      "[patch-deps] polymarket websocket URL/payload patch already present.",
    );
  } else if (polymarketSrc.includes(websocketUrlBuggy)) {
    polymarketSrc = polymarketSrc.replace(websocketUrlBuggy, websocketUrlFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket URL/payload patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket URL helper changed; skip patch.",
    );
  }

  const websocketSendBuggy = `  sendWebsocketMessage(message) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      this.wsPendingMessages.push(message);
      return;
    }
    this.websocket.send(JSON.stringify(message));
  }`;

  const websocketSendFixed = `  sendWebsocketMessage(message) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      this.wsPendingMessages.push(message);
      return;
    }
    const { _channel, _authenticated, ...wireMessage } = message;
    this.websocket.send(JSON.stringify(wireMessage));
  }`;

  if (
    polymarketSrc.includes(
      "const { _channel, _authenticated, ...wireMessage } = message;",
    )
  ) {
    console.log(
      "[patch-deps] polymarket websocket send patch already present.",
    );
  } else if (polymarketSrc.includes(websocketSendBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketSendBuggy,
      websocketSendFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket send patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket send helper changed; skip patch.",
    );
  }

  const websocketPingBuggy = `  startPing() {
    if (this.wsPingInterval) {
      clearInterval(this.wsPingInterval);
    }
    this.wsPingInterval = setInterval(() => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.ping();
      }
    }, WS_PING_INTERVAL_MS);
  }`;

  const websocketPingFixed = `  startPing() {
    if (this.wsPingInterval) {
      clearInterval(this.wsPingInterval);
    }
    this.wsPingInterval = setInterval(() => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.send("PING");
      }
    }, WS_PING_INTERVAL_MS);
  }`;

  if (polymarketSrc.includes('this.websocket.send("PING");')) {
    console.log(
      "[patch-deps] polymarket websocket ping patch already present.",
    );
  } else if (polymarketSrc.includes(websocketPingBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketPingBuggy,
      websocketPingFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket ping patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket ping helper changed; skip patch.",
    );
  }

  const websocketHandlersBuggy = `  setupWebsocketHandlers(socket) {
    socket.on("open", () => {
      this.websocketStatus = "connected";
      this.wsReconnectAttempts = 0;
      this.wsLastError = null;
      this.startPing();
      const pending = [...this.wsPendingMessages];
      this.wsPendingMessages = [];
      const pendingKeys = new Set(pending.map((message) => this.getSubscriptionKey(message.channel, message.assets_ids ?? [], false)));
      for (const message of pending) {
        this.sendWebsocketMessage(message);
      }
      this.wsSubscriptions.forEach((subscription) => {
        const key = this.getSubscriptionKey(subscription.channel, subscription.assetIds, subscription.authenticated);
        if (!pendingKeys.has(key)) {
          this.sendWebsocketMessage({
            type: "subscribe",
            channel: subscription.channel,
            assets_ids: subscription.assetIds
          });
        }
      });
    });
    socket.on("message", (data) => {
      const text = this.normalizeRawData(data);
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error) {
          this.wsLastError = parsed.error;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown parse error";
        this.polymarketRuntime.logger.warn("Failed to parse websocket message:", errorMessage);
      }
    });
    socket.on("close", () => {
      this.websocketStatus = "disconnected";
      this.stopPing();
      this.scheduleReconnect();
    });
    socket.on("error", (error) => {
      this.websocketStatus = "error";
      this.wsLastError = error.message;
      this.polymarketRuntime.logger.error("WebSocket error:", error.message);
      this.scheduleReconnect();
    });
  }`;

  const websocketHandlersFixed = `  setupWebsocketHandlers(socket) {
    socket.on("open", () => {
      this.websocketStatus = "connected";
      this.wsReconnectAttempts = 0;
      this.wsLastError = null;
      this.startPing();
      const pending = [...this.wsPendingMessages];
      this.wsPendingMessages = [];
      const pendingKeys = new Set(pending.map((message) => this.getSubscriptionKey(message._channel ?? "market", this.extractWebsocketIds(message), Boolean(message._authenticated))));
      for (const message of pending) {
        this.sendWebsocketMessage(message);
      }
      this.wsSubscriptions.forEach((subscription) => {
        const key = this.getSubscriptionKey(subscription.channel, subscription.assetIds, subscription.authenticated);
        if (!pendingKeys.has(key)) {
          this.sendWebsocketMessage(this.buildWebsocketMessage(subscription.channel, subscription.assetIds, subscription.authenticated));
        }
      });
    });
    socket.on("message", (data) => {
      const text = this.normalizeRawData(data).trim();
      if (text === "PING" || text === "PONG" || text.length === 0) {
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error) {
          this.wsLastError = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown parse error";
        this.polymarketRuntime.logger.warn("Failed to parse websocket message:", errorMessage);
      }
    });
    socket.on("close", () => {
      this.websocketStatus = "disconnected";
      this.stopPing();
      this.scheduleReconnect();
    });
    socket.on("error", (error) => {
      this.websocketStatus = "error";
      this.wsLastError = error.message;
      this.polymarketRuntime.logger.error("WebSocket error:", error.message);
      this.scheduleReconnect();
    });
  }`;

  if (polymarketSrc.includes('message._channel ?? "market"')) {
    console.log(
      "[patch-deps] polymarket websocket handler patch already present.",
    );
  } else if (polymarketSrc.includes(websocketHandlersBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketHandlersBuggy,
      websocketHandlersFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket handler patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket handlers changed; skip patch.",
    );
  }

  const websocketConnectBuggy = `  async connectWebsocket() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.websocket && this.websocket.readyState === WebSocket.CONNECTING) {
      return;
    }
    const url = this.websocketUrl ?? this.resolveWebsocketUrl();
    this.websocketUrl = url;
    this.websocketStatus = "connecting";
    this.wsShouldReconnect = true;
    if (this.websocket) {
      this.websocket.removeAllListeners();
      this.websocket.terminate();
      this.websocket = null;
    }
    const socket = new WebSocket(url);
    this.websocket = socket;
    this.setupWebsocketHandlers(socket);
  }`;

  const websocketConnectFixed = `  async connectWebsocket() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.websocket && this.websocket.readyState === WebSocket.CONNECTING) {
      return;
    }
    const fallbackChannel = this.wsSubscriptions.values().next().value?.channel ?? "market";
    const url = this.websocketUrl ?? this.resolveWebsocketUrl(fallbackChannel);
    this.websocketUrl = url;
    this.websocketStatus = "connecting";
    this.wsShouldReconnect = true;
    if (this.websocket) {
      this.websocket.removeAllListeners();
      this.websocket.terminate();
      this.websocket = null;
    }
    const socket = new WebSocket(url);
    this.websocket = socket;
    this.setupWebsocketHandlers(socket);
  }`;

  if (
    polymarketSrc.includes(
      'const fallbackChannel = this.wsSubscriptions.values().next().value?.channel ?? "market";',
    )
  ) {
    console.log(
      "[patch-deps] polymarket websocket connect patch already present.",
    );
  } else if (polymarketSrc.includes(websocketConnectBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketConnectBuggy,
      websocketConnectFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket connect patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket connect helper changed; skip patch.",
    );
  }

  const websocketResubscribeBuggy = `  resubscribeAll() {
    this.wsSubscriptions.forEach((subscription) => {
      if (subscription.status === "active" || subscription.status === "pending") {
        this.sendWebsocketMessage({
          type: "subscribe",
          channel: subscription.channel,
          assets_ids: subscription.assetIds
        });
      }
    });
  }`;

  const websocketResubscribeFixed = `  resubscribeAll() {
    this.wsSubscriptions.forEach((subscription) => {
      if (subscription.status === "active" || subscription.status === "pending") {
        this.sendWebsocketMessage(this.buildWebsocketMessage(subscription.channel, subscription.assetIds, subscription.authenticated));
      }
    });
  }`;

  if (polymarketSrc.includes(websocketResubscribeFixed)) {
    console.log(
      "[patch-deps] polymarket websocket resubscribe patch already present.",
    );
  } else if (polymarketSrc.includes(websocketResubscribeBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketResubscribeBuggy,
      websocketResubscribeFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket resubscribe patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket resubscribe helper changed; skip patch.",
    );
  }

  const websocketStartBuggy = `  async startWebsocket(config) {
    this.websocketUrl = config.url ?? this.resolveWebsocketUrl();
    await this.connectWebsocket();
    config.channels.forEach((channel) => {
      if (config.assetIds.length > 0) {
        this.recordSubscription(channel, config.assetIds, config.authenticated, "pending");
      }
    });
    if (this.websocketStatus === "connected") {
      this.resubscribeAll();
    } else {
      config.channels.forEach((channel) => {
        if (config.assetIds.length > 0) {
          this.wsPendingMessages.push({
            type: "subscribe",
            channel,
            assets_ids: config.assetIds
          });
        }
      });
    }
    return this.getWebsocketStatusSnapshot();
  }`;

  const websocketStartFixed = `  async startWebsocket(config) {
    const primaryChannel = config.channels[0] ?? "market";
    const requiresIds = primaryChannel !== "user";
    const useAuthenticated = primaryChannel === "user" && Boolean(config.authenticated);
    if (config.channels.length > 1) {
      throw new Error("Polymarket websocket uses separate market and user endpoints. Use one channel type per connection.");
    }
    if (requiresIds && config.assetIds.length === 0) {
      throw new Error("At least one asset ID is required for market websocket subscriptions.");
    }
    this.websocketUrl = config.url ?? this.resolveWebsocketUrl(primaryChannel);
    await this.connectWebsocket();
    config.channels.forEach((channel) => {
      if (config.assetIds.length > 0 || channel === "user") {
        this.recordSubscription(channel, config.assetIds, useAuthenticated, "pending");
      }
    });
    if (this.websocketStatus === "connected") {
      this.resubscribeAll();
    } else {
      config.channels.forEach((channel) => {
        if (config.assetIds.length > 0 || channel === "user") {
          this.wsPendingMessages.push(this.buildWebsocketMessage(channel, config.assetIds, useAuthenticated));
        }
      });
    }
    return this.getWebsocketStatusSnapshot();
  }`;

  if (
    polymarketSrc.includes(
      "At least one asset ID is required for market websocket subscriptions.",
    )
  ) {
    console.log(
      "[patch-deps] polymarket websocket start patch already present.",
    );
  } else if (polymarketSrc.includes(websocketStartBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketStartBuggy,
      websocketStartFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket start patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket start helper changed; skip patch.",
    );
  }

  const websocketSubscribeBuggy = `  async subscribeWebsocket(channel, assetIds, authenticated) {
    if (authenticated && !this.hasWebsocketCredentials()) {
      throw new Error("Authenticated websocket requires CLOB API credentials.");
    }
    if (assetIds.length === 0) {
      throw new Error("At least one asset ID is required for subscription.");
    }
    await this.connectWebsocket();
    this.recordSubscription(channel, assetIds, authenticated, "pending");
    this.sendWebsocketMessage({ type: "subscribe", channel, assets_ids: assetIds });
  }`;

  const websocketSubscribeFixed = `  async subscribeWebsocket(channel, assetIds, authenticated) {
    const normalizedChannel = this.normalizeChannel(channel) ?? "market";
    const useAuthenticated = normalizedChannel === "user" && Boolean(authenticated);
    if (useAuthenticated && !this.hasWebsocketCredentials()) {
      throw new Error("Authenticated websocket requires CLOB API credentials.");
    }
    if (normalizedChannel !== "user" && assetIds.length === 0) {
      throw new Error("At least one asset ID is required for market websocket subscriptions.");
    }
    const activeChannels = new Set([...this.wsSubscriptions.values()].map((subscription) => subscription.channel));
    if (activeChannels.size > 0 && !activeChannels.has(normalizedChannel)) {
      throw new Error("Polymarket websocket uses separate market and user endpoints. Stop the current websocket before switching channels.");
    }
    this.websocketUrl = this.resolveWebsocketUrl(normalizedChannel);
    await this.connectWebsocket();
    this.recordSubscription(normalizedChannel, assetIds, useAuthenticated, "pending");
    this.sendWebsocketMessage(this.buildWebsocketMessage(normalizedChannel, assetIds, useAuthenticated, "subscribe"));
  }`;

  if (
    polymarketSrc.includes(
      "Stop the current websocket before switching channels.",
    )
  ) {
    console.log(
      "[patch-deps] polymarket websocket subscribe patch already present.",
    );
  } else if (polymarketSrc.includes(websocketSubscribeBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketSubscribeBuggy,
      websocketSubscribeFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket subscribe patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket subscribe helper changed; skip patch.",
    );
  }

  const websocketUnsubscribeBuggy = `  async unsubscribeWebsocket(channel, assetIds) {
    await this.connectWebsocket();
    const keysToDelete = [];
    this.wsSubscriptions.forEach((subscription, key) => {
      const sameChannel = subscription.channel === channel;
      const sameAssets = assetIds.length === 0 || subscription.assetIds.length === assetIds.length && [...subscription.assetIds].sort().join(",") === [...assetIds].sort().join(",");
      if (sameChannel && sameAssets) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      this.wsSubscriptions.delete(key);
    }
    this.sendWebsocketMessage({
      type: "unsubscribe",
      channel,
      assets_ids: assetIds.length > 0 ? assetIds : undefined
    });
  }`;

  const websocketUnsubscribeFixed = `  async unsubscribeWebsocket(channel, assetIds) {
    const normalizedChannel = this.normalizeChannel(channel) ?? "market";
    this.websocketUrl = this.resolveWebsocketUrl(normalizedChannel);
    await this.connectWebsocket();
    const keysToDelete = [];
    this.wsSubscriptions.forEach((subscription, key) => {
      const sameChannel = subscription.channel === normalizedChannel;
      const sameAssets = assetIds.length === 0 || subscription.assetIds.length === assetIds.length && [...subscription.assetIds].sort().join(",") === [...assetIds].sort().join(",");
      if (sameChannel && sameAssets) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      this.wsSubscriptions.delete(key);
    }
    this.sendWebsocketMessage(this.buildWebsocketMessage(normalizedChannel, assetIds, normalizedChannel === "user", "unsubscribe"));
  }`;

  if (
    polymarketSrc.includes(
      'this.buildWebsocketMessage(normalizedChannel, assetIds, normalizedChannel === "user", "unsubscribe")',
    )
  ) {
    console.log(
      "[patch-deps] polymarket websocket unsubscribe patch already present.",
    );
  } else if (polymarketSrc.includes(websocketUnsubscribeBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketUnsubscribeBuggy,
      websocketUnsubscribeFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket unsubscribe patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket unsubscribe helper changed; skip patch.",
    );
  }

  const websocketSnapshotBuggy = `  getWebsocketStatusSnapshot() {
    return {
      status: this.websocketStatus,
      url: this.websocketUrl ?? this.resolveWebsocketUrl(),
      subscriptions: [...this.wsSubscriptions.values()],
      reconnectAttempts: this.wsReconnectAttempts,
      lastError: this.wsLastError ?? undefined
    };
  }`;

  const websocketSnapshotFixed = `  getWebsocketStatusSnapshot() {
    const fallbackChannel = this.wsSubscriptions.values().next().value?.channel ?? "market";
    return {
      status: this.websocketStatus,
      url: this.websocketUrl ?? this.resolveWebsocketUrl(fallbackChannel),
      subscriptions: [...this.wsSubscriptions.values()],
      reconnectAttempts: this.wsReconnectAttempts,
      lastError: this.wsLastError ?? undefined
    };
  }`;

  if (
    polymarketSrc.includes(
      "url: this.websocketUrl ?? this.resolveWebsocketUrl(fallbackChannel),",
    )
  ) {
    console.log(
      "[patch-deps] polymarket websocket snapshot patch already present.",
    );
  } else if (polymarketSrc.includes(websocketSnapshotBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketSnapshotBuggy,
      websocketSnapshotFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket snapshot patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket snapshot helper changed; skip patch.",
    );
  }

  const websocketSetupBuggy = `  async setupWebsocket(options) {
    const channels = this.normalizeChannels(options.channels);
    const assetIds = options.assetIds ?? [];
    let hasCredentials = this.hasWebsocketCredentials();
    if (options.authenticated && !hasCredentials) {
      const creds = await this.ensureApiCredentials({
        allowCreate: this.getAllowCreateApiKey()
      });
      hasCredentials = Boolean(creds);
    }
    const enableAuthenticated = Boolean(options.authenticated) && hasCredentials;
    const statusSnapshot = await this.startWebsocket({
      url: options.url,
      channels,
      assetIds,
      authenticated: enableAuthenticated
    });
    return {
      config: {
        url: statusSnapshot.url,
        channels,
        assetIds,
        authenticated: enableAuthenticated,
        status: statusSnapshot.status
      },
      statusSnapshot,
      hasCredentials
    };
  }`;

  const websocketSetupFixed = `  async setupWebsocket(options) {
    const channels = this.normalizeChannels(options.channels);
    const assetIds = options.assetIds ?? [];
    if (channels.length > 1) {
      throw new Error("Polymarket websocket uses separate market and user endpoints. Use one channel type per connection.");
    }
    const primaryChannel = channels[0] ?? "market";
    let hasCredentials = this.hasWebsocketCredentials();
    if (primaryChannel === "user" && !hasCredentials) {
      const creds = await this.ensureApiCredentials({
        allowCreate: this.getAllowCreateApiKey()
      });
      hasCredentials = Boolean(creds);
    }
    const enableAuthenticated = primaryChannel === "user" ? hasCredentials : false;
    if (primaryChannel === "user" && !enableAuthenticated) {
      throw new Error("User websocket requires CLOB API credentials.");
    }
    const statusSnapshot = await this.startWebsocket({
      url: options.url,
      channels,
      assetIds,
      authenticated: enableAuthenticated
    });
    return {
      config: {
        url: statusSnapshot.url,
        channels,
        assetIds,
        authenticated: enableAuthenticated,
        status: statusSnapshot.status
      },
      statusSnapshot,
      hasCredentials
    };
  }`;

  if (polymarketSrc.includes("User websocket requires CLOB API credentials.")) {
    console.log(
      "[patch-deps] polymarket websocket setup patch already present.",
    );
  } else if (polymarketSrc.includes(websocketSetupBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      websocketSetupBuggy,
      websocketSetupFixed,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket websocket setup patch.");
  } else {
    console.log(
      "[patch-deps] polymarket websocket setup helper changed; skip patch.",
    );
  }

  // Patch: Strip bulky raw arrays from POLYMARKET_PROVIDER values so they
  // don't pollute the LLM context and cause garbled output. The provider's
  // `text` field already contains a clean formatted summary via
  // formatAccountStateText(); the raw positions/trades/orders arrays in
  // `values` are redundant and confuse the model with long hex token IDs.
  const providerReturnBuggy = `    const result = {
      text: fullText,
      values,
      data: {
        timestamp: new Date().toISOString(),
        service: "polymarket"
      }
    };
    return result;`;

  const providerReturnFixed = `    // Strip bulky arrays AND account detail fields from values to keep
    // LLM context clean — the condensed text has everything the model needs.
    delete values.positions;
    delete values.activeOrders;
    delete values.recentTrades;
    delete values.conditionalBalances;
    delete values.orderScoringStatus;
    delete values.walletAddress;
    delete values.collateralBalance;
    delete values.apiKeysCount;
    delete values.certRequired;
    delete values.accountStateLastUpdated;
    delete values.accountStateExpiresAt;
    delete values.hasActivityContext;
    delete values.lastActivityType;
    delete values.activityCount;
    const result = {
      text: fullText,
      values,
      data: {
        timestamp: new Date().toISOString(),
        service: "polymarket"
      }
    };
    return result;`;

  if (polymarketSrc.includes("delete values.walletAddress;")) {
    console.log(
      "[patch-deps] polymarket provider values cleanup patch (v2) already present.",
    );
  } else if (polymarketSrc.includes("delete values.orderScoringStatus;")) {
    // v1 patch present — upgrade to v2 with extended field deletions
    polymarketSrc = polymarketSrc.replace(
      "delete values.orderScoringStatus;",
      `delete values.orderScoringStatus;
    delete values.walletAddress;
    delete values.collateralBalance;
    delete values.apiKeysCount;
    delete values.certRequired;
    delete values.accountStateLastUpdated;
    delete values.accountStateExpiresAt;
    delete values.hasActivityContext;
    delete values.lastActivityType;
    delete values.activityCount;`,
    );
    polymarketPatched += 1;
    console.log(
      "[patch-deps] Upgraded polymarket provider values cleanup to v2 (extended field strip).",
    );
  } else if (polymarketSrc.includes(providerReturnBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      providerReturnBuggy,
      providerReturnFixed,
    );
    polymarketPatched += 1;
    console.log(
      "[patch-deps] Applied polymarket provider values cleanup patch (v2).",
    );
  } else {
    console.log(
      "[patch-deps] polymarket provider return changed; skip values cleanup patch.",
    );
  }

  // Patch: Condense the provider's `text` output so the LLM doesn't echo
  // verbose wallet/position/order data during streaming. Replace the fullText
  // construction with a short one-liner summary.
  const fullTextBuildBuggy = `    let fullText = baseText;
    if (accountStateText) {
      fullText += \`

\${accountStateText}\`;
    }
    if (activityContextText) {
      fullText += \`

\${activityContextText}\`;
    }`;

  const fullTextBuildFixed = `    // Condensed provider text — keeps LLM streaming clean.
    let fullText = baseText;
    if (accountStateText) {
      // Extract just the key numbers instead of the full dump
      const balMatch = accountStateText.match(/USDC Balance: ([\\d.]+)/);
      const posMatch = accountStateText.match(/Open Positions: (\\d+)/);
      const ordMatch = accountStateText.match(/Active Orders: (\\d+)/);
      const bal = balMatch ? balMatch[1] : "?";
      const pos = posMatch ? posMatch[1] : "0";
      const ord = ordMatch ? ordMatch[1] : "0";
      fullText += \` USDC: $\${bal}, \${pos} position(s), \${ord} open order(s).\`;
    }
    // Skip activityContextText — it causes the LLM to parrot market history`;

  if (polymarketSrc.includes("Condensed provider text")) {
    console.log(
      "[patch-deps] polymarket provider text condensing patch already present.",
    );
  } else if (polymarketSrc.includes(fullTextBuildBuggy)) {
    polymarketSrc = polymarketSrc.replace(
      fullTextBuildBuggy,
      fullTextBuildFixed,
    );
    polymarketPatched += 1;
    console.log(
      "[patch-deps] Applied polymarket provider text condensing patch.",
    );
  } else {
    console.log(
      "[patch-deps] polymarket fullText build changed; skip text condensing patch.",
    );
  }

  // Patch: Replace verbose markdown order response with a natural sentence.
  const orderSentenceMarker = "order response sentence patch";
  if (polymarketSrc.includes("shares of \" + mktLabel")) {
    console.log(
      `[patch-deps] polymarket ${orderSentenceMarker} already present.`,
    );
  } else {
    const successMarker = `responseText = \`✅ **Order Placed Successfully**`;
    const successIdx = polymarketSrc.indexOf(successMarker);
    if (successIdx !== -1) {
      // Find the end of the success block: the "} else {" that starts the error block
      const elseIdx = polymarketSrc.indexOf("} else {", successIdx);
      if (elseIdx !== -1) {
        const oldBlock = polymarketSrc.substring(successIdx, elseIdx).trimEnd();
        const newBlock = `// ${orderSentenceMarker}: natural conversational output
      {
        const mktLabel = marketQuestion ? marketQuestion : tokenId.slice(0, 12) + "...";
        const statusLabel = orderResponse.status === "matched" ? "filled immediately" : (orderResponse.status ?? "live");
        responseText = sideText + " " + size + " shares of " + mktLabel + " @ $" + price.toFixed(2) + " (~$" + totalValue + "). order " + statusLabel + ".";
        if (orderResponse.orderId) responseText += " id: " + orderResponse.orderId;
      }`;
        polymarketSrc = polymarketSrc.replace(oldBlock, newBlock);
        polymarketPatched += 1;
        console.log(
          `[patch-deps] Applied polymarket ${orderSentenceMarker}.`,
        );
      }
    } else {
      console.log(
        `[patch-deps] polymarket order success response pattern not found; skip ${orderSentenceMarker}.`,
      );
    }
  }

  // Patch: Fix C1/H10 — balance heuristic `bal < 1000` is wrong.
  // The CLOB API returns human-readable balance (e.g. "42.5"), NOT raw wei.
  // The `< 1000` check wrongly divides balances ≥1000 by 1e6, giving ~0.
  // Fix: just use the balance as-is (it's already human-readable).
  const balHeuristicBuggy = `size = bal < 1000 ? Math.floor(bal) : Math.floor(bal / 1e6);`;
  const balHeuristicFixed = `size = Math.floor(bal);`;
  if (polymarketSrc.includes(balHeuristicFixed) && !polymarketSrc.includes(balHeuristicBuggy)) {
    console.log("[patch-deps] polymarket balance heuristic patch already present.");
  } else if (polymarketSrc.includes(balHeuristicBuggy)) {
    polymarketSrc = polymarketSrc.replaceAll(balHeuristicBuggy, balHeuristicFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket balance heuristic patch (C1/H10).");
  }
  // Also fix the variant in the market scan path
  const balHeuristic2Buggy = `const confirmedSize = bal < 1000 ? bal : bal / 1e6;`;
  const balHeuristic2Fixed = `const confirmedSize = bal;`;
  if (polymarketSrc.includes(balHeuristic2Buggy)) {
    polymarketSrc = polymarketSrc.replaceAll(balHeuristic2Buggy, balHeuristic2Fixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket market-scan balance heuristic patch (C2).");
  }

  // Patch: H1 — USDC pre-check before BUY orders to avoid cryptic CLOB errors.
  // Insert a balance check right after `client = await initializeClobClientWithCreds(runtime)`.
  const usdcPreCheckMarker = "USDC pre-check for BUY";
  const clientInitSuccess = `    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await sendError(callback, \`Failed to initialize trading client: \${errMsg}\`, "Authentication");
      return { success: false, text: \`Client initialization failed: \${errMsg}\`, error: errMsg };`;
  // We insert the check BEFORE the token validation block
  const tokenValidationStart = `    try {
      const orderBook = await client.getOrderBook(tokenId);`;
  // Also upgrade the v1 pre-check to v2 (with micro-unit conversion)
  const preCheckV1Marker = `const usdcBal = parseFloat(balResp?.balance ?? "0");
        const orderCost = price * size;
        if (usdcBal < orderCost)`;
  const preCheckV2Marker = `const rawBal = parseFloat(balResp?.balance ?? "0");
        const usdcBal = rawBal >= 1000 ? rawBal / 1e6 : rawBal;`;
  if (polymarketSrc.includes(preCheckV2Marker)) {
    console.log("[patch-deps] polymarket USDC pre-check patch (v2) already present.");
  } else if (polymarketSrc.includes(preCheckV1Marker)) {
    polymarketSrc = polymarketSrc.replace(
      `const usdcBal = parseFloat(balResp?.balance ?? "0");`,
      `const rawBal = parseFloat(balResp?.balance ?? "0");
        const usdcBal = rawBal >= 1000 ? rawBal / 1e6 : rawBal; // CLOB may return raw micro-units`,
    );
    polymarketPatched += 1;
    console.log("[patch-deps] Upgraded polymarket USDC pre-check to v2 (micro-unit conversion).");
  } else if (polymarketSrc.includes(usdcPreCheckMarker)) {
    console.log("[patch-deps] polymarket USDC pre-check patch already present.");
  } else if (polymarketSrc.includes(tokenValidationStart)) {
    const usdcCheck = `    // ${usdcPreCheckMarker}: avoid cryptic CLOB errors when balance is insufficient
    if (side === "BUY") {
      try {
        const balResp = await client.getBalanceAllowance({ asset_type: "COLLATERAL" });
        const rawBal = parseFloat(balResp?.balance ?? "0");
        const usdcBal = rawBal >= 1000 ? rawBal / 1e6 : rawBal; // CLOB may return raw micro-units
        const orderCost = price * size;
        if (usdcBal < orderCost) {
          await sendError(callback, "Insufficient USDC balance: $" + usdcBal.toFixed(2) + " available but order costs ~$" + orderCost.toFixed(2), "Deposit more USDC or reduce order size");
          return { success: false, text: "Insufficient USDC: $" + usdcBal.toFixed(2) + " < $" + orderCost.toFixed(2), error: "insufficient_balance" };
        }
      } catch (balErr) {
        runtime.logger.warn("[placeOrderAction] USDC pre-check failed (continuing): " + (balErr?.message || balErr));
      }
    }
`;
    polymarketSrc = polymarketSrc.replace(tokenValidationStart, usdcCheck + tokenValidationStart);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket USDC pre-check patch (H1).");
  }

  // Patch: M1 — feeRateBps defaults to "0" which means 0% taker fee.
  // This may cause orders to be rejected if the CLOB expects a fee commitment.
  // Default to "100" (1%) which is the standard Polymarket taker fee.
  const feeRateBuggy = `const feeRateBps = llmResult?.feeRateBps ?? "0";`;
  const feeRateFixed = `const feeRateBps = llmResult?.feeRateBps ?? "100";`;
  if (polymarketSrc.includes(feeRateFixed)) {
    console.log("[patch-deps] polymarket feeRateBps default patch already present.");
  } else if (polymarketSrc.includes(feeRateBuggy)) {
    polymarketSrc = polymarketSrc.replace(feeRateBuggy, feeRateFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket feeRateBps default patch (M1).");
  }

  // Patch: G5 — Max order guard. Prevent catastrophic accidental large orders.
  // Add a $500 max guard (configurable via env) after the min order check.
  const maxOrderMarker = "max order guard";
  const minOrderCheck = `    if (orderValue < 0.5) {`;
  if (polymarketSrc.includes(maxOrderMarker)) {
    console.log("[patch-deps] polymarket max order guard already present.");
  } else if (polymarketSrc.includes(minOrderCheck)) {
    const maxOrderGuard = `    // ${maxOrderMarker}: prevent accidental large orders
    const maxOrderUsd = parseFloat(runtime.getSetting?.("POLYMARKET_MAX_ORDER_USD") || "500") || 500;
    if (orderValue > maxOrderUsd) {
      await sendError(callback, "Order value ($" + orderValue.toFixed(2) + ") exceeds max allowed ($" + maxOrderUsd + "). Set POLYMARKET_MAX_ORDER_USD to change limit.", "Safety check");
      return { success: false, text: "Order too large: $" + orderValue.toFixed(2) + " > $" + maxOrderUsd, error: "max_order_exceeded" };
    }
`;
    polymarketSrc = polymarketSrc.replace(minOrderCheck, maxOrderGuard + minOrderCheck);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket max order guard (G5).");
  }

  // Patch: H4/H7 — Keyword validation too lax. Short words like "buy", "sell",
  // "bet", "market", "order" match normal conversation, causing PLACE_ORDER to
  // activate on non-trading messages. Require at least 2 keywords to match
  // (or one Polymarket-specific keyword) instead of just one.
  const keywordValidationBuggy = `const __avKeywordOk = __avKeywords.length > 0 && __avKeywords.some((kw) => kw.length > 0 && __avText.includes(kw));`;
  const keywordValidationFixed = `const __avKeywordOk = __avKeywords.length > 0 && (() => { const hits = __avKeywords.filter((kw) => kw.length > 0 && __avText.includes(kw)); return hits.some((k) => k === "polymarket" || k === "wager") || hits.length >= 2; })();`;
  if (polymarketSrc.includes("hits.some((k) => k === \"polymarket\"")) {
    console.log("[patch-deps] polymarket keyword strictness patch already present.");
  } else if (polymarketSrc.includes(keywordValidationBuggy)) {
    // Only patch the PLACE_ORDER validate (first occurrence near placeOrderAction)
    const placeOrderValidateIdx = polymarketSrc.indexOf("name: \"POLYMARKET_PLACE_ORDER\"");
    if (placeOrderValidateIdx !== -1) {
      const nextKeywordIdx = polymarketSrc.indexOf(keywordValidationBuggy, placeOrderValidateIdx);
      if (nextKeywordIdx !== -1 && nextKeywordIdx - placeOrderValidateIdx < 5000) {
        polymarketSrc = polymarketSrc.substring(0, nextKeywordIdx) + keywordValidationFixed + polymarketSrc.substring(nextKeywordIdx + keywordValidationBuggy.length);
        polymarketPatched += 1;
        console.log("[patch-deps] Applied polymarket keyword strictness patch (H4/H7).");
      }
    }
  }

  // Patch: C1 in service — formatBalance heuristic `< 1000` is fragile.
  // CLOB API returns raw micro-unit USDC balance (6 decimals).
  // The original code only divides by 1e6 when value >= 1000, meaning
  // sub-$0.001 balances (raw < 1000) are shown as their raw micro-unit value.
  // Fix: always divide by 1e6 since USDC is always 6-decimal raw from CLOB.
  const formatBalBuggyOrig = `      if (numValue > 0 && numValue < 1000) {
        return numValue.toFixed(6);
      }
      return (numValue / 10 ** USDC_DECIMALS).toFixed(6);`;
  // Also match our own v1 patch if already applied (remove-division variant)
  const formatBalV1 = `      // Balance is already human-readable from CLOB API
      return numValue.toFixed(6);`;
  const formatBalFixed = `      // Always divide by USDC decimals — CLOB returns raw micro-units
      return (numValue / 10 ** USDC_DECIMALS).toFixed(6);`;
  if (polymarketSrc.includes("Always divide by USDC decimals")) {
    console.log("[patch-deps] polymarket formatBalance patch (v2) already present.");
  } else if (polymarketSrc.includes(formatBalV1)) {
    polymarketSrc = polymarketSrc.replace(formatBalV1, formatBalFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Upgraded polymarket formatBalance patch to v2 (always divide).");
  } else if (polymarketSrc.includes(formatBalBuggyOrig)) {
    polymarketSrc = polymarketSrc.replace(formatBalBuggyOrig, formatBalFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket formatBalance patch v2 (C1-service).");
  }

  // Patch: C4 — Position calculation order. Trades from getTradesPaginated
  // come in reverse chronological order (newest first). calculatePositionsFromTrades
  // needs oldest-first to compute correct weighted average prices.
  const calcPosBuggy = `function calculatePositionsFromTrades(trades) {
  const positionsMap = new Map;
  for (const trade of trades) {`;
  const calcPosFixed = `function calculatePositionsFromTrades(trades) {
  const positionsMap = new Map;
  // Sort trades oldest-first so weighted avg price is computed correctly
  const sorted = [...trades].sort((a, b) => {
    const tA = a.match_time || a.timestamp || 0;
    const tB = b.match_time || b.timestamp || 0;
    return (typeof tA === "string" ? tA : String(tA)).localeCompare(typeof tB === "string" ? tB : String(tB));
  });
  for (const trade of sorted) {`;
  if (polymarketSrc.includes("Sort trades oldest-first")) {
    console.log("[patch-deps] polymarket position calc order patch already present.");
  } else if (polymarketSrc.includes(calcPosBuggy)) {
    polymarketSrc = polymarketSrc.replace(calcPosBuggy, calcPosFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket position calc order patch (C4).");
  }

  // Patch: C5 — Order dedup. Prevent submitting identical orders within 10s.
  // Insert a dedup check at the top of the handler, right after LLM parsing.
  const dedupMarker = "order dedup guard";
  const dedupInsertPoint = `    let tokenId = llmResult?.tokenId ?? "";`;
  if (polymarketSrc.includes(dedupMarker)) {
    console.log("[patch-deps] polymarket order dedup patch already present.");
  } else if (polymarketSrc.includes(dedupInsertPoint)) {
    const dedupCode = `    // ${dedupMarker}: prevent duplicate orders within 10 seconds
    {
      const dedupKey = [llmResult?.tokenId, llmResult?.side, llmResult?.price, llmResult?.dollarAmount, llmResult?.shares, llmResult?.marketName].join("|");
      if (!globalThis.__polyOrderDedup) globalThis.__polyOrderDedup = new Map();
      const lastTime = globalThis.__polyOrderDedup.get(dedupKey);
      const now = Date.now();
      if (lastTime && now - lastTime < 10000) {
        await sendError(callback, "Duplicate order detected (same params within 10s). Please wait.", "Dedup");
        return { success: false, text: "Duplicate order blocked", error: "dedup" };
      }
      globalThis.__polyOrderDedup.set(dedupKey, now);
      // Prune old entries
      for (const [k, t] of globalThis.__polyOrderDedup) { if (now - t > 30000) globalThis.__polyOrderDedup.delete(k); }
    }
`;
    polymarketSrc = polymarketSrc.replace(dedupInsertPoint, dedupCode + dedupInsertPoint);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket order dedup patch (C5).");
  }

  // Patch: H2 — SELL orders should use FAK (Fill-and-Kill) instead of GTC.
  // GTC sell orders lock the shares until they fill or are manually cancelled.
  // FAK attempts to fill immediately at the best available price; unfilled
  // remainder is cancelled, releasing shares back to the seller.
  const sellFakMarker = "SELL defaults to FAK";
  const orderTypeValidation = `    if (!["GTC", "FOK", "GTD", "FAK"].includes(orderType)) {
      orderType = "GTC";
    }`;
  if (polymarketSrc.includes(sellFakMarker)) {
    console.log("[patch-deps] polymarket SELL FAK default patch already present.");
  } else if (polymarketSrc.includes(orderTypeValidation)) {
    const sellFakFix = `    if (!["GTC", "FOK", "GTD", "FAK"].includes(orderType)) {
      orderType = "GTC";
    }
    // ${sellFakMarker} to avoid locking shares in resting orders
    if (side === "SELL" && orderType === "GTC") {
      orderType = "FAK";
      runtime.logger.info("[placeOrderAction] SELL order type changed from GTC to FAK (avoid locking shares)");
    }`;
    polymarketSrc = polymarketSrc.replace(orderTypeValidation, sellFakFix);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket SELL FAK default patch (H2).");
  }

  // Patch: H3 — GTD without expiration → fallback to GTC.
  // The CLOB API rejects GTD orders without an expiration timestamp.
  const gtdBuggy = `        const clobOrderType = orderType === "GTD" ? ClobOrderType.GTD : ClobOrderType.GTC;
        orderResponse = await client.createAndPostOrder(orderArgs, undefined, clobOrderType);`;
  const gtdFixed = `        let clobOrderType = orderType === "GTD" ? ClobOrderType.GTD : ClobOrderType.GTC;
        // GTD requires expiration — fall back to GTC if none provided
        if (clobOrderType === ClobOrderType.GTD) {
          runtime.logger.warn("[placeOrderAction] GTD order without expiration — falling back to GTC");
          clobOrderType = ClobOrderType.GTC;
        }
        orderResponse = await client.createAndPostOrder(orderArgs, undefined, clobOrderType);`;
  if (polymarketSrc.includes("GTD order without expiration")) {
    console.log("[patch-deps] polymarket GTD fallback patch already present.");
  } else if (polymarketSrc.includes(gtdBuggy)) {
    polymarketSrc = polymarketSrc.replace(gtdBuggy, gtdFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket GTD fallback patch (H3).");
  }

  // Patch: H9 — Increase trade history limit from 50 to 500.
  // 50 trades is not enough to correctly compute positions for active traders.
  const tradeLimitBuggy = `var RECENT_TRADES_LIMIT = 50;`;
  const tradeLimitFixed = `var RECENT_TRADES_LIMIT = 500;`;
  if (polymarketSrc.includes(tradeLimitFixed)) {
    console.log("[patch-deps] polymarket trade limit patch already present.");
  } else if (polymarketSrc.includes(tradeLimitBuggy)) {
    polymarketSrc = polymarketSrc.replace(tradeLimitBuggy, tradeLimitFixed);
    polymarketPatched += 1;
    console.log("[patch-deps] Applied polymarket trade limit patch (H9: 50→500).");
  }

  // Patch: Error response for failed orders — convert markdown to sentence.
  const failedOrderBuggy = `      responseText = \`❌ **Order Placement Failed**`;
  if (polymarketSrc.includes(failedOrderBuggy)) {
    const failedBlockEnd = polymarketSrc.indexOf(`• Size: \${size} shares\``, polymarketSrc.indexOf(failedOrderBuggy));
    if (failedBlockEnd !== -1) {
      const endIdx = failedBlockEnd + `• Size: \${size} shares\``.length + 1;
      const oldBlock = polymarketSrc.substring(polymarketSrc.indexOf(failedOrderBuggy), endIdx);
      const newBlock = `      const failMsg = orderResponse.errorMsg || responseAny.error || responseAny.message || responseAny.reason || "unknown error";
      responseText = "order failed: " + failMsg + " (" + side.toLowerCase() + " " + size + " @ $" + price.toFixed(2) + ")";`;
      polymarketSrc = polymarketSrc.replace(oldBlock, newBlock);
      polymarketPatched += 1;
      console.log("[patch-deps] Applied polymarket failed-order sentence patch.");
    }
  } else if (polymarketSrc.includes("order failed:")) {
    console.log("[patch-deps] polymarket failed-order sentence patch already present.");
  }

  // ── Action filter always-include tags: ensure Polymarket actions survive BM25 filtering ──
  // The elizaOS action filter drops low-scoring actions. Adding the "always-include"
  // tag to action objects ensures the filter natively preserves them without relying
  // on runtime config patching (which can fail due to service startup timing).
  const alwaysIncludeMarker = "pm-always-include-tags-v1";
  if (!polymarketSrc.includes(alwaysIncludeMarker)) {
    const actionNames = [
      "POLYMARKET_PLACE_ORDER",
      "POLYMARKET_GET_MARKETS",
      "POLYMARKET_RESEARCH_MARKET",
      "POLYMARKET_GET_TOKEN_INFO",
      "POLYMARKET_GET_ORDER_BOOK_DEPTH",
      "POLYMARKET_CHECK_ORDER_SCORING",
    ];
    let tagsPatched = 0;
    for (const actionName of actionNames) {
      const needle = `name: "${actionName}",\n  similes:`;
      const replacement = `name: "${actionName}",\n  tags: ["always-include", "polymarket"], /* ${alwaysIncludeMarker} */\n  similes:`;
      if (polymarketSrc.includes(needle)) {
        polymarketSrc = polymarketSrc.replace(needle, replacement);
        tagsPatched++;
      }
    }
    if (tagsPatched > 0) {
      polymarketPatched++;
      console.log(`[patch-deps] Applied polymarket always-include tags patch (${tagsPatched} actions).`);
    } else {
      console.log("[patch-deps] polymarket always-include tags: action patterns not found; skipping.");
    }
  } else {
    console.log("[patch-deps] polymarket always-include tags patch already present.");
  }

  // ── Sell price derivation: use best bid from order book when price is default $0.50 ──
  // The upstream code at line ~22577 defaults to 0.5 when no price is specified,
  // but the order book lookup at ~22650 only runs AFTER the acknowledgement is sent.
  // Problem: for SELL orders the $0.50 default causes FAK orders to fail when
  // the actual market price is much higher (e.g. 0.85). The fix ensures the
  // order book price override at ~22650 always fires for SELL orders by widening
  // the condition to also check when side is SELL.
  const sellPriceMarker = "sell-best-bid-patch-v1";
  if (!polymarketSrc.includes(sellPriceMarker)) {
    const oldPriceCheck = `if (price <= 0 || price === 0.5) {
        const bestAsk = orderBook.asks?.[0]?.price;
        const bestBid = orderBook.bids?.[0]?.price;
        if (side === "BUY" && bestAsk) {`;
    if (polymarketSrc.includes(oldPriceCheck)) {
      polymarketSrc = polymarketSrc.replace(
        oldPriceCheck,
        `/* ${sellPriceMarker} */ if (price <= 0 || price === 0.5 || side === "SELL") {
        const bestAsk = orderBook.asks?.[0]?.price;
        const bestBid = orderBook.bids?.[0]?.price;
        if (side === "BUY" && bestAsk) {`,
      );
      polymarketPatched++;
      console.log("[patch-deps] Applied polymarket sell-best-bid price patch.");
    } else {
      console.log("[patch-deps] polymarket sell-best-bid: target pattern not found; skipping.");
    }
  } else {
    console.log("[patch-deps] polymarket sell-best-bid price patch already present.");
  }

  // ── Minimum order size: enforce CLOB minimum of 5 shares ──
  // Polymarket CLOB rejects orders with fewer than 5 shares. The upstream code
  // only checks dollar value (>= $0.50) but not share count. This patch adds
  // a pre-flight check and helpful error message.
  const minSizeMarker = "min-share-size-patch-v1";
  if (!polymarketSrc.includes(minSizeMarker)) {
    const minSizeTarget = `if (orderValue < 0.5) {`;
    if (polymarketSrc.includes(minSizeTarget)) {
      polymarketSrc = polymarketSrc.replace(
        minSizeTarget,
        `/* ${minSizeMarker} */ if (size < 5) {
      await sendError(callback, \`Order size (\${size} shares) is below Polymarket minimum of 5 shares. Try increasing the amount.\`, "Minimum 5 shares required");
      return { success: false, text: \`Order too small: \${size} shares < 5 minimum\`, error: "min_order_size" };
    }
    if (orderValue < 0.5) {`,
      );
      polymarketPatched++;
      console.log("[patch-deps] Applied polymarket min-share-size patch.");
    } else {
      console.log("[patch-deps] polymarket min-share-size: target pattern not found; skipping.");
    }
  } else {
    console.log("[patch-deps] polymarket min-share-size patch already present.");
  }

  if (polymarketPatched > 0) {
    writeFileSync(polymarketTarget, polymarketSrc, "utf8");
    console.log(
      `[patch-deps] Wrote ${polymarketPatched} plugin-polymarket patch(es).`,
    );
  }
}

/**
 * Patch @elizaos/plugin-evm to fix requireActionSpec / requireProviderSpec
 * throwing on mismatched spec names (e.g. "BRIDGE" vs "CROSS_CHAIN_TRANSFER").
 *
 * The generated action/provider spec maps use canonical names but the code
 * looks them up by simile names. We patch the require functions to return
 * a fallback { name, description } instead of throwing.
 * Remove once plugin-evm publishes a fix.
 */
const evmTargets = findAllPackageDists("@elizaos/plugin-evm", [
  "dist/index.js",
]);

if (evmTargets.length === 0) {
  console.log("[patch-deps] plugin-evm dist not found, skipping patch.");
}

for (const evmTarget of evmTargets) {
  console.log(`[patch-deps] Patching evm: ${evmTarget}`);
  let evmSrc = readFileSync(evmTarget, "utf8");
  let evmPatched = 0;

  const evmBuggyRequireAction = `function requireActionSpec(name) {
  const spec = getActionSpec(name);
  if (!spec) {
    throw new Error(\`Action spec not found: \${name}\`);
  }
  return spec;
}`;

  const evmFixedRequireAction = `function requireActionSpec(name) {
  const spec = getActionSpec(name);
  if (!spec) {
    return { name, description: name };
  }
  return spec;
}`;

  const evmBuggyRequireProvider = `function requireProviderSpec(name) {
  const spec = getProviderSpec(name);
  if (!spec) {
    throw new Error(\`Provider spec not found: \${name}\`);
  }
  return spec;
}`;

  const evmFixedRequireProvider = `function requireProviderSpec(name) {
  const spec = getProviderSpec(name);
  if (!spec) {
    return { name, description: name, dynamic: true };
  }
  return spec;
}`;

  if (evmSrc.includes("return { name, description: name };")) {
    console.log(
      "[patch-deps] plugin-evm requireActionSpec patch already present.",
    );
  } else if (evmSrc.includes(evmBuggyRequireAction)) {
    evmSrc = evmSrc.replace(evmBuggyRequireAction, evmFixedRequireAction);
    evmPatched += 1;
    console.log(
      "[patch-deps] Applied plugin-evm requireActionSpec fallback patch.",
    );
  } else {
    console.log(
      "[patch-deps] plugin-evm requireActionSpec signature changed; skip patch.",
    );
  }

  if (evmSrc.includes("return { name, description: name, dynamic: true };")) {
    console.log(
      "[patch-deps] plugin-evm requireProviderSpec patch already present.",
    );
  } else if (evmSrc.includes(evmBuggyRequireProvider)) {
    evmSrc = evmSrc.replace(evmBuggyRequireProvider, evmFixedRequireProvider);
    evmPatched += 1;
    console.log(
      "[patch-deps] Applied plugin-evm requireProviderSpec fallback patch.",
    );
  } else {
    console.log(
      "[patch-deps] plugin-evm requireProviderSpec signature changed; skip patch.",
    );
  }

  if (evmPatched > 0) {
    writeFileSync(evmTarget, evmSrc, "utf8");
    console.log(`[patch-deps] Wrote ${evmPatched} plugin-evm patch(es).`);
  }
}

/**
 * Patch @elizaos/core: wrap ensureEmbeddingDimension() in try/catch so
 * initResolver() always fires. Without this, a disposed ONNX model during
 * runtime restart blocks ALL service registrations (including Polymarket).
 */
const coreTargets = findAllPackageDists("@elizaos/core", [
  "dist/node/index.node.js",
]);
if (coreTargets.length === 0) {
  console.log(
    "[patch-deps] @elizaos/core dist not found, skipping init-resolver patch.",
  );
} else {
  for (const coreTarget of coreTargets) {
    let coreSrc = readFileSync(coreTarget, "utf8");

    // Patch 1: Wrap ensureEmbeddingDimension in try/catch
    const initResolverBuggy = `    const embeddingModel = this.getModel(ModelType.TEXT_EMBEDDING);
    if (!embeddingModel) {
      this.logger.warn({ src: "agent", agentId: this.agentId }, "No TEXT_EMBEDDING model registered, skipping embedding setup");
    } else {
      await this.ensureEmbeddingDimension();
    }
    if (this.initResolver) {
      this.initResolver();
      this.initResolver = undefined;
    }`;

    const initResolverFixed = `    const embeddingModel = this.getModel(ModelType.TEXT_EMBEDDING);
    if (!embeddingModel) {
      this.logger.warn({ src: "agent", agentId: this.agentId }, "No TEXT_EMBEDDING model registered, skipping embedding setup");
    } else {
      try {
        await this.ensureEmbeddingDimension();
      } catch (embErr) {
        this.logger.warn({ src: "agent", agentId: this.agentId, error: String(embErr) }, "ensureEmbeddingDimension failed — continuing without embeddings");
      }
    }
    if (this.initResolver) {
      this.logger.info({ src: "agent", agentId: this.agentId }, "initResolver() firing — services can now start");
      this.initResolver();
      this.initResolver = undefined;
    }`;

    if (
      coreSrc.includes(
        "ensureEmbeddingDimension failed — continuing without embeddings",
      )
    ) {
      // Already patched — check if initResolver logging is also present
      if (!coreSrc.includes("initResolver() firing")) {
        // Add the logging to the already-patched version
        coreSrc = coreSrc.replace(
          `    if (this.initResolver) {\n      this.initResolver();\n      this.initResolver = undefined;\n    }`,
          `    if (this.initResolver) {\n      this.logger.info({ src: "agent", agentId: this.agentId }, "initResolver() firing — services can now start");\n      this.initResolver();\n      this.initResolver = undefined;\n    }`,
        );
        console.log(
          "[patch-deps] core init-resolver safety patch present; added initResolver logging.",
        );
      } else {
        console.log(
          "[patch-deps] core init-resolver safety patch + logging already present.",
        );
      }
    } else if (coreSrc.includes(initResolverBuggy)) {
      coreSrc = coreSrc.replace(initResolverBuggy, initResolverFixed);
      console.log(
        "[patch-deps] Applied core init-resolver safety patch + logging.",
      );
    } else {
      console.log(
        "[patch-deps] core init sequence changed; skip init-resolver patch.",
      );
    }

    // Patch 2: Escalate service registration logging from debug to info
    const svcDebugBuggy = `        this.serviceRegistrationStatus.set(serviceType, "pending");
        this.registerService(service3).catch((error) => {`;
    const svcDebugFixed = `        this.serviceRegistrationStatus.set(serviceType, "pending");
        this.logger.info({ src: "agent", agentId: this.agentId, plugin: pluginToRegister.name, serviceType }, "Starting service registration for " + serviceType);
        this.registerService(service3).catch((error) => {`;

    if (coreSrc.includes("Starting service registration for")) {
      console.log(
        "[patch-deps] core service-registration logging already present.",
      );
    } else if (coreSrc.includes(svcDebugBuggy)) {
      coreSrc = coreSrc.replace(svcDebugBuggy, svcDebugFixed);
      console.log(
        "[patch-deps] Applied core service-registration info logging.",
      );
    } else {
      console.log(
        "[patch-deps] core service-registration pattern changed; skip logging patch.",
      );
    }

    // Patch 3: Escalate registerService internal logging
    const regSvcDebugBuggy = `    this.logger.debug({ src: "agent", agentId: this.agentId, serviceType }, "Service waiting for init");`;
    const regSvcDebugFixed = `    this.logger.info({ src: "agent", agentId: this.agentId, serviceType }, "Service waiting for init");`;

    if (coreSrc.includes(regSvcDebugFixed)) {
      console.log(
        "[patch-deps] core registerService waiting-for-init logging already present.",
      );
    } else if (coreSrc.includes(regSvcDebugBuggy)) {
      coreSrc = coreSrc.replace(regSvcDebugBuggy, regSvcDebugFixed);
      console.log(
        "[patch-deps] Applied core registerService waiting-for-init info logging.",
      );
    }

    const regSvcRegisteredBuggy = `    this.logger.debug({ src: "agent", agentId: this.agentId, serviceType }, "Service registered");`;
    const regSvcRegisteredFixed = `    this.logger.info({ src: "agent", agentId: this.agentId, serviceType }, "Service registered successfully");`;

    if (coreSrc.includes("Service registered successfully")) {
      console.log(
        "[patch-deps] core registerService registered logging already present.",
      );
    } else if (coreSrc.includes(regSvcRegisteredBuggy)) {
      coreSrc = coreSrc.replace(regSvcRegisteredBuggy, regSvcRegisteredFixed);
      console.log(
        "[patch-deps] Applied core registerService registered info logging.",
      );
    }

    // Patch: REPLY action makes a second LLM call and sends a duplicate
    // "Generated reply:" message via callback. The streaming <text> field
    // already contains the response, so REPLY's callback is always redundant.
    // Suppress ALL "Generated reply:" returns and their callbacks.
    // Patch: Skip the "Executed action: REPLY" memory creation when REPLY
    // callback was suppressed. The actionResult.text is "" so the fallback
    // `Executed action: ${action.name}` fires and creates a visible bubble.
    const actionMemoryBuggy = `        const actionMemory = {
          id: actionId,
          entityId: this.agentId,
          roomId: message2.roomId,
          worldId: message2.worldId,
          content: {
            text: actionResult?.text || \`Executed action: \${action.name}\`,
            source: "action"
          }
        };
        await this.createMemory(actionMemory, "messages");`;

    const actionMemoryFixed = `        // Skip action memory for suppressed REPLY — it would create a
        // duplicate "Executed action: REPLY" bubble in the chat UI.
        const skipMemory = action.name === "REPLY" && (!actionResult?.text || actionResult?.data?.skipped);
        if (!skipMemory) {
          const actionMemory = {
            id: actionId,
            entityId: this.agentId,
            roomId: message2.roomId,
            worldId: message2.worldId,
            content: {
              text: actionResult?.text || \`Executed action: \${action.name}\`,
              source: "action"
            }
          };
          await this.createMemory(actionMemory, "messages");
        }`;

    if (coreSrc.includes("Skip action memory for suppressed REPLY")) {
      console.log(
        "[patch-deps] core REPLY memory suppression patch already present.",
      );
    } else if (coreSrc.includes(actionMemoryBuggy)) {
      coreSrc = coreSrc.replaceAll(actionMemoryBuggy, actionMemoryFixed);
      console.log(
        "[patch-deps] Applied core REPLY memory suppression patch.",
      );
    } else {
      console.log(
        "[patch-deps] core action memory pattern changed; skip REPLY memory patch.",
      );
    }

    if (coreSrc.includes("REPLY callback suppressed")) {
      console.log(
        "[patch-deps] core REPLY callback suppression patch already present.",
      );
    } else {
      // Replace all callback(responseContent) calls right before "Generated reply:" returns
      let replyPatches = 0;
      // Pattern 1: callback + const now + Generated reply
      const pat1 = `    if (callback) {\n      await callback(responseContent);\n    }\n    const now = Date.now();\n    return {\n      text: \`Generated reply: \${responseContent.text}\`,`;
      if (coreSrc.includes(pat1)) {
        coreSrc = coreSrc.replace(pat1,
          `    // REPLY callback suppressed — streaming <text> already sent the response.\n    const now = Date.now();\n    return {\n      text: "",`);
        replyPatches++;
      }
      // Pattern 2: callback + return (no const now)
      const pat2 = `    if (callback) {\n      await callback(responseContent);\n    }\n    return {\n      text: \`Generated reply: \${responseContent.text}\`,`;
      if (coreSrc.includes(pat2)) {
        coreSrc = coreSrc.replaceAll(pat2,
          `    // REPLY callback suppressed — streaming <text> already sent the response.\n    return {\n      text: "",`);
        replyPatches++;
      }
      if (replyPatches > 0) {
        console.log(
          `[patch-deps] Applied core REPLY callback suppression patch (${replyPatches} pattern(s)).`,
        );
      } else {
        console.log(
          "[patch-deps] core REPLY callback pattern not found; skip REPLY suppression patch.",
        );
      }
    }

    // Write all core patches
    writeFileSync(coreTarget, coreSrc, "utf8");
    console.log(`[patch-deps] Wrote core patches to ${coreTarget}`);
  }
}

patchBunExports(root, "@elizaos/plugin-coding-agent");

// @noble/curves and @noble/hashes publish ".js" subpath exports, while ethers
// imports extensionless paths like "@noble/curves/secp256k1" and
// "@noble/hashes/sha3". Add extensionless aliases so Bun resolves them.
patchExtensionlessJsExports(root, "@noble/curves");

// @noble/hashes only exports subpaths with explicit ".js" suffixes (for
// example "./sha3.js"), but ethers imports "@noble/hashes/sha3". Add
// extensionless aliases so Bun resolves the published package at runtime.
patchExtensionlessJsExports(root, "@noble/hashes");
patchNobleHashesCompat(root);
patchProperLockfileSignalExitCompat(root);

/**
 * Patch @pixiv/three-vrm node-material helpers for Three r168+.
 *
 * The published nodes bundle still references THREE_WEBGPU.tslFn in the
 * compatibility helper. Three r182 no longer exports tslFn from three/webgpu,
 * so Vite/Rollup emits a noisy missing-export warning even though the runtime
 * branch would use THREE_TSL.Fn instead. We patch the helper to the modern
 * path directly because this repo pins Three r182.
 */
function findAllThreeVrmNodeFiles() {
  const targets = [];
  const relPaths = ["lib/nodes/index.module.js", "lib/nodes/index.cjs"];
  const searchRoots = [root, resolve(root, "apps/app")];

  for (const searchRoot of searchRoots) {
    for (const relPath of relPaths) {
      const npmTarget = resolve(
        searchRoot,
        `node_modules/@pixiv/three-vrm/${relPath}`,
      );
      if (existsSync(npmTarget) && !targets.includes(npmTarget)) {
        targets.push(npmTarget);
      }
    }

    const bunCacheDir = resolve(searchRoot, "node_modules/.bun");
    if (existsSync(bunCacheDir)) {
      try {
        const entries = readdirSync(bunCacheDir);
        for (const entry of entries) {
          if (entry.startsWith("@pixiv+three-vrm@")) {
            for (const relPath of relPaths) {
              const bunTarget = resolve(
                bunCacheDir,
                entry,
                `node_modules/@pixiv/three-vrm/${relPath}`,
              );
              if (existsSync(bunTarget) && !targets.includes(bunTarget)) {
                targets.push(bunTarget);
              }
            }
          }
        }
      } catch {
        // Ignore bun cache traversal errors.
      }
    }
  }

  return targets;
}

const threeVrmNodeTargets = findAllThreeVrmNodeFiles();
const threeVrmFnCompatBuggy = `return THREE_WEBGPU.tslFn(jsFunc);`;
const threeVrmFnCompatFixed = `return THREE_TSL.Fn(jsFunc);`;

if (threeVrmNodeTargets.length === 0) {
  console.log("[patch-deps] three-vrm nodes bundle not found, skipping patch.");
} else {
  console.log(
    `[patch-deps] Found ${threeVrmNodeTargets.length} three-vrm node file(s) to patch.`,
  );

  for (const target of threeVrmNodeTargets) {
    console.log(`[patch-deps] Patching three-vrm nodes: ${target}`);
    let src = readFileSync(target, "utf8");

    if (!src.includes(threeVrmFnCompatBuggy)) {
      if (src.includes(threeVrmFnCompatFixed)) {
        console.log("  - three-vrm FnCompat patch already present.");
      } else {
        console.log(
          "  - three-vrm FnCompat signature changed — patch may no longer be needed.",
        );
      }
      continue;
    }

    src = src.replaceAll(threeVrmFnCompatBuggy, threeVrmFnCompatFixed);
    writeFileSync(target, src, "utf8");
    console.log("  - Applied three-vrm FnCompat patch for Three r182.");
  }
}
