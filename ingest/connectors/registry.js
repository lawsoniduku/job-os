/**
 * ingest/connectors/registry.js
 * =============================
 * Built from verify.js runs (July 2026 — 60/81 slugs live, 5,781 jobs).
 * ACTIVE arrays = confirmed live via verify.js. Only these are ingested.
 * CANDIDATES_TO_VERIFY = next batch to probe.
 *
 * Non-ATS remote companies (custom pages — use manual upload template):
 *   Doist, Netlify, PiggyVest, Cowrywise, and several African fintechs
 *   that 404 on every standard ATS.
 */

// ── GREENHOUSE ────────────────────────────────────────────────
export const GREENHOUSE_COMPANIES = [
  // Nigerian / African ✅
  { slug: "jumia",             name: "Jumia",       region: "Africa"  },
  { slug: "carbon",            name: "Carbon",      region: "Nigeria" },
  { slug: "moniepoint",        name: "Moniepoint",  region: "Nigeria",
    apiBase: "https://boards-api.eu.greenhouse.io"                    },
  // Remote-first global ✅
  { slug: "automatticcareers", name: "Automattic"   },  // 82 countries [RF]
  { slug: "gitlab",            name: "GitLab"       },  // 65+ countries [RF]
  { slug: "remotecom",         name: "Remote.com"   },  // EOR [RF]
  { slug: "canonical",         name: "Canonical"    },  // 75+ countries [RF]
  { slug: "elastic",           name: "Elastic"      },  // distributed-first [RF]
  { slug: "mozilla",           name: "Mozilla"      },  // [RF]
  { slug: "grafanalabs",       name: "Grafana Labs"  },  // remote-first [RF]
  { slug: "customerio",        name: "Customer.io"  },  // [RF]
  { slug: "webflow",           name: "Webflow"      },  // [RF]
  { slug: "mattermost",        name: "Mattermost"   },  // open-source [RF]
  // High-volume global ✅
  { slug: "stripe",            name: "Stripe"       },
  { slug: "airbnb",            name: "Airbnb"       },
  { slug: "dropbox",           name: "Dropbox"      },
  { slug: "robinhood",         name: "Robinhood"    },
  { slug: "coinbase",          name: "Coinbase"     },
  { slug: "databricks",        name: "Databricks"   },
  { slug: "twilio",            name: "Twilio"       },
  { slug: "cloudflare",        name: "Cloudflare"   },
  { slug: "discord",           name: "Discord"      },
  { slug: "figma",             name: "Figma"        },
  { slug: "anthropic",         name: "Anthropic"    },
  { slug: "postman",           name: "Postman"      },
  { slug: "cockroachlabs",     name: "Cockroach Labs"},
  { slug: "vercel",            name: "Vercel"       },  // [RF]
  // ── promoted from candidates via verify.js 2026-07-18 ──
  { slug: "turing",            name: "Turing"       },  // ✅ 28  · remote IT global [RF]
  { slug: "agoda",             name: "Agoda"        },  // ✅ 273 · relocation support, 70 nationalities
  // web3 / crypto — verified live
  { slug: "ripple",            name: "Ripple"       },  // ✅ 140
  { slug: "gemini",            name: "Gemini"       },  // ✅ 35
  { slug: "okx",               name: "OKX"          },  // ✅ 315
  { slug: "bitgo",             name: "BitGo"        },  // ✅ 37
  { slug: "fireblocks",        name: "Fireblocks"   },  // ✅ 61
  { slug: "bitpanda",          name: "Bitpanda"     },  // ✅ 51
  { slug: "bitso",             name: "Bitso"        },  // ✅ 11 · LatAm crypto
  { slug: "aptoslabs",         name: "Aptos Labs"   },  // ✅ 6
  { slug: "layerzerolabs",     name: "LayerZero Labs"}, // ✅ 19
];

// ── LEVER ─────────────────────────────────────────────────────
export const LEVER_COMPANIES = [
  { slug: "spotify",   name: "Spotify"   },
  { slug: "remofirst", name: "RemoFirst" },  // EOR [RF]
  { slug: "kinsta",    name: "Kinsta"    },  // fully remote [RF]
  { slug: "tala",      name: "Tala",      region: "Africa" },  // ✅ 9 jobs
  // ── promoted from candidates via verify.js 2026-07-18 ──
  { slug: "binance",   name: "Binance"   },  // ✅ 279 · 130+ countries [RF]
  { slug: "anchorage", name: "Anchorage Digital" },  // ✅ 45
  { slug: "coingecko", name: "CoinGecko" },  // ✅ 4 · [RF]
];

// ── ASHBY ──────────────────────────────────────────────────────
export const ASHBY_COMPANIES = [
  // Nigerian / African ✅
  { slug: "sabi",     name: "Sabi",   region: "Africa"  },
  { slug: "lemfi",    name: "LemFi",  region: "Nigeria" },
  { slug: "andela",   name: "Andela", region: "Africa"  },  // ✅ 16 jobs
  // Remote-first ✅ (verified on Ashby)
  { slug: "zapier",   name: "Zapier"    },  // ✅ 17 · 800+ staff [RF]
  { slug: "buffer",   name: "Buffer"    },  // ✅ 1 · remote pioneer [RF]
  { slug: "camunda",  name: "Camunda"   },  // ✅ 34 · fully remote [RF]
  { slug: "oyster",   name: "Oyster HR" },  // ✅ 13 · EOR, hires from Africa [RF]
  // Ashby native ✅
  { slug: "linear",       name: "Linear"          },  // [RF]
  { slug: "ramp",         name: "Ramp"             },
  { slug: "openai",       name: "OpenAI"           },
  { slug: "notion",       name: "Notion"           },
  { slug: "runway",       name: "Runway"           },
  { slug: "posthog",      name: "PostHog"          },  // [RF]
  { slug: "replit",       name: "Replit"           },  // [RF]
  { slug: "supabase",     name: "Supabase"         },  // [RF]
  { slug: "browserbase",  name: "Browserbase"      },  // [RF]
  { slug: "deel",         name: "Deel"             },  // EOR [RF]
  { slug: "clipboard",    name: "Clipboard Health" },
  { slug: "mintlify",     name: "Mintlify"         },  // [RF]
  // ── promoted from candidates via verify.js 2026-07-18 ──
  { slug: "mercor",       name: "Mercor"           },  // ✅ 70 · AI talent marketplace
  { slug: "kraken.com",   name: "Kraken"           },  // ✅ 49 · NOTE: slug really does include ".com"
  { slug: "trm-labs",     name: "TRM Labs"         },  // ✅ 121 · crypto compliance
  { slug: "uniswap",      name: "Uniswap Labs"     },  // ✅ 10
  { slug: "ledger",       name: "Ledger"           },  // ✅ 10
  { slug: "paxos",        name: "Paxos"            },  // ✅ 9
  { slug: "polygon-labs", name: "Polygon Labs"     },  // ✅ 3
  { slug: "matter-labs",  name: "Matter Labs"      },  // ✅ 2 · zkSync
  { slug: "opensea",      name: "OpenSea"          },  // ✅ 1
];

// ── WORKABLE ──────────────────────────────────────────────────
export const WORKABLE_COMPANIES = [
  { slug: "kuda",       name: "Kuda",       region: "Nigeria" },  // ✅ 15
  { slug: "paystack",   name: "Paystack",   region: "Nigeria" },  // ✅ live (0 now)
  { slug: "palmpay",    name: "PalmPay",    region: "Nigeria" },  // ✅ live (0 now)
  { slug: "flutterwave",name: "Flutterwave",region: "Africa"  },  // ✅ live (0 now)
];

// ── SMARTRECRUITERS ───────────────────────────────────────────
export const SMARTRECRUITERS_COMPANIES = [
  { slug: "Andela",      name: "Andela",      region: "Africa"  },
  { slug: "Visa",        name: "Visa"         },
  { slug: "MTNNigeria",  name: "MTN Nigeria",  region: "Nigeria" },
  { slug: "Bolt",        name: "Bolt"         },
  { slug: "Flutterwave", name: "Flutterwave",  region: "Africa"  },  // ✅ live (0 now)
  { slug: "Interswitch", name: "Interswitch",  region: "Nigeria" },  // ✅ live (0 now)
];

// ── CANDIDATES TO VERIFY ──────────────────────────────────────
// run: node ingest/verify.js — promote any ✅ into the ACTIVE arrays above.
// Everything here 404'd on last check; kept for slug-variant retries.
// Most African fintechs below use CUSTOM career pages (no standard ATS) —
// use the manual upload template for their roles instead.
export const CANDIDATES_TO_VERIFY = {
  greenhouse: [],
  lever: [],
  ashby: [],
  workable: [],
};

/**
 * PROBED & CONFIRMED DEAD — verify.js run 2026-07-18 (all returned 404).
 * Do NOT re-add these to ACTIVE without re-probing; the slug is wrong or the
 * company has moved off that ATS. Listed so we don't waste a future batch
 * re-testing the same dead ends.
 *
 *   greenhouse: hashicorp (IBM acquisition), toptal, waveapps, smileidentityinc
 *   lever:      netlify, piggyvest, cowrywise, lendable
 *   ashby:      doist, fincra, nomba, brass, risevest, moove-africa,
 *               chainlink-labs  <-- slug wrong; Chainlink IS on Ashby, find real slug
 *   workable:   opay
 *
 * LIVE BUT RETURNING 0 JOBS (kept active — they may post again; each costs one
 * request per run): ashby/deel, workable/{paystack,palmpay,flutterwave},
 * smartrecruiters/{Andela,MTNNigeria,Bolt,Flutterwave,Interswitch}
 */
