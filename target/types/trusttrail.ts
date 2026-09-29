/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/trusttrail.json`.
 */
export type Trusttrail = {
  "address": "BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s",
  "metadata": {
    "name": "trusttrail",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addWriter",
      "discriminator": [
        95,
        14,
        80,
        179,
        133,
        216,
        154,
        108
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "whitelist",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  114,
                  105,
                  116,
                  101,
                  114,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "writer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initScoreV2",
      "discriminator": [
        90,
        1,
        94,
        86,
        137,
        30,
        186,
        156
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Pays rent for the new account (the borrower, or the pool on first borrow)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "wallet"
        },
        {
          "name": "reputation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  117,
                  115,
                  116,
                  45,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initWriterWhitelist",
      "discriminator": [
        87,
        247,
        19,
        144,
        156,
        160,
        101,
        163
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "whitelist",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  114,
                  105,
                  116,
                  101,
                  114,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "recordEvent",
      "discriminator": [
        32,
        2,
        109,
        205,
        6,
        116,
        72,
        229
      ],
      "accounts": [
        {
          "name": "writer",
          "signer": true
        },
        {
          "name": "whitelist",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  114,
                  105,
                  116,
                  101,
                  114,
                  95,
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "wallet"
        },
        {
          "name": "reputation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  117,
                  115,
                  116,
                  45,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "sasSigner",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  97,
                  115,
                  45,
                  115,
                  105,
                  103,
                  110,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "credential",
          "address": "HqhwM4J9UoJBq2HGBPn32QN1y7gkASPdX5nxBLCY5sje"
        },
        {
          "name": "schema",
          "address": "3q96PNm9Dv6wiR6ZkmJJDm9uUQZUKvqPH8su9Born1A9"
        },
        {
          "name": "attestation",
          "writable": true
        },
        {
          "name": "sasProgram",
          "address": "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "principalUsdc",
          "type": "u64"
        },
        {
          "name": "openedAt",
          "type": "i64"
        },
        {
          "name": "dueAt",
          "type": "i64"
        },
        {
          "name": "outcome",
          "type": "u8"
        },
        {
          "name": "loan",
          "type": "pubkey"
        },
        {
          "name": "interestPaidUsdc",
          "type": "u64"
        },
        {
          "name": "collateralRatioBps",
          "type": "u16"
        },
        {
          "name": "tierAtOpen",
          "type": "u8"
        }
      ]
    },
    {
      "name": "updateScore",
      "discriminator": [
        188,
        226,
        238,
        41,
        14,
        241,
        105,
        215
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userReputation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  117,
                  115,
                  116,
                  45,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user"
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "newScore",
          "type": "u16"
        },
        {
          "name": "mask",
          "type": "u64"
        },
        {
          "name": "newFlags",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "userReputation",
      "discriminator": [
        86,
        95,
        94,
        218,
        215,
        219,
        207,
        37
      ]
    },
    {
      "name": "userReputationV2",
      "discriminator": [
        68,
        237,
        128,
        106,
        198,
        158,
        236,
        215
      ]
    },
    {
      "name": "writerWhitelist",
      "discriminator": [
        73,
        117,
        176,
        122,
        124,
        73,
        69,
        210
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the counter authority can update this counter"
    },
    {
      "code": 6001,
      "name": "counterOverflow",
      "msg": "Counter has reached the maximum value"
    },
    {
      "code": 6002,
      "name": "writerWhiteListOverflow",
      "msg": "The white_writer list is full"
    },
    {
      "code": 6003,
      "name": "nameAlreadyInWhiteWriterList",
      "msg": "The name already exists in white writer's list"
    },
    {
      "code": 6004,
      "name": "signerNotApproved",
      "msg": "The signer is not an approved writer"
    },
    {
      "code": 6005,
      "name": "invalidOutcome",
      "msg": "Outcome must be 0: on time, 1: late, 2: liquidated, 3: defaulted"
    }
  ],
  "types": [
    {
      "name": "globalConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "userReputation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "score",
            "type": "u16"
          },
          {
            "name": "lastUpdate",
            "type": "i64"
          },
          {
            "name": "claimsBitmask",
            "type": "u64"
          },
          {
            "name": "flags",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "userReputationV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "score",
            "type": "u16"
          },
          {
            "name": "nativeScore",
            "type": "u16"
          },
          {
            "name": "importedScore",
            "type": "u16"
          },
          {
            "name": "importDate",
            "type": "i64"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "loansRepaidOnTime",
            "type": "u16"
          },
          {
            "name": "lateRepaidLoans",
            "type": "u16"
          },
          {
            "name": "liquidatedLoans",
            "type": "u16"
          },
          {
            "name": "currentOnTimeStreak",
            "type": "u16"
          },
          {
            "name": "lastLiquidationDate",
            "type": "i64"
          },
          {
            "name": "totalUsdcRepaid",
            "type": "u64"
          },
          {
            "name": "lastUpdate",
            "type": "i64"
          },
          {
            "name": "sPlusBps",
            "type": "u64"
          },
          {
            "name": "sMinusBps",
            "type": "u64"
          },
          {
            "name": "sMinusAt",
            "type": "i64"
          },
          {
            "name": "exposureBps",
            "type": "u64"
          },
          {
            "name": "meaningfulOnTime",
            "type": "u16"
          },
          {
            "name": "meaningfulWeightBps",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "writerWhitelist",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "signers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "globalConfigSeed",
      "type": "bytes",
      "value": "[103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "helloWorldLamports",
      "type": "u64",
      "value": "1"
    },
    {
      "name": "sasSignerSeed",
      "docs": [
        "Seed for our PDA [\"sas-signer\"], the only authorized signer on our credential.",
        "MUST match SAS_SIGNER_SEED in scripts/sas/setup-sas.ts."
      ],
      "type": "bytes",
      "value": "[115, 97, 115, 45, 115, 105, 103, 110, 101, 114]"
    },
    {
      "name": "userReputationSeed",
      "type": "bytes",
      "value": "[116, 114, 117, 115, 116, 45, 118, 49]"
    },
    {
      "name": "userReputationV2Seed",
      "type": "bytes",
      "value": "[116, 114, 117, 115, 116, 45, 118, 50]"
    },
    {
      "name": "writerWhitelistSeed",
      "type": "bytes",
      "value": "[119, 114, 105, 116, 101, 114, 95, 119, 104, 105, 116, 101, 108, 105, 115, 116]"
    }
  ]
};
