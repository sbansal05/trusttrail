/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pool.json`.
 */
export type Pool = {
  "address": "Eg1s6qF3UhrUYuccyKy9pMBqDQd4beQjYYYZdGs4EkWL",
  "metadata": {
    "name": "pool",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "TrustTrail reputation-priced USDC pool"
  },
  "instructions": [
    {
      "name": "accrueInterest",
      "discriminator": [
        47,
        40,
        115,
        198,
        91,
        12,
        222,
        49
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "pool"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "addCollateral",
      "discriminator": [
        127,
        82,
        121,
        42,
        161,
        176,
        249,
        206
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feedId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "minTier",
          "type": "u8"
        },
        {
          "name": "maxAgeSecs",
          "type": "u32"
        },
        {
          "name": "liqThresholdBps",
          "type": "u16"
        },
        {
          "name": "liqBonusBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "borrow",
      "discriminator": [
        228,
        253,
        131,
        202,
        207,
        116,
        89,
        18
      ],
      "accounts": [
        {
          "name": "borrower",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Pool's USDC vault (pays out the loan)."
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "reputation",
          "docs": [
            "The borrower's TrustTrail score account (owned by the TrustTrail program)."
          ],
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
                "path": "borrower"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                161,
                210,
                161,
                118,
                139,
                34,
                219,
                27,
                170,
                249,
                169,
                208,
                44,
                197,
                206,
                24,
                249,
                172,
                104,
                100,
                63,
                130,
                116,
                144,
                104,
                183,
                86,
                84,
                68,
                238,
                178,
                190
              ]
            }
          }
        },
        {
          "name": "borrowerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "borrower"
              }
            ]
          }
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "borrower"
              },
              {
                "kind": "account",
                "path": "borrowerState.nextLoanId",
                "account": "borrowerState"
              }
            ]
          }
        },
        {
          "name": "collateralConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "collateralConfig.mint",
                "account": "collateralConfig"
              }
            ]
          }
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "priceUpdate"
        },
        {
          "name": "borrowerCollateral",
          "writable": true
        },
        {
          "name": "borrowerUsdc",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "collateralAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "lender",
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lenderUsdc",
          "docs": [
            "Lender's USDC account (source)."
          ],
          "writable": true
        },
        {
          "name": "lenderLp",
          "docs": [
            "Lender's LP account (receives shares)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initPool",
      "discriminator": [
        116,
        233,
        199,
        204,
        115,
        159,
        171,
        36
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vault",
          "docs": [
            "USDC vault, owned by the pool PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "lpMint",
          "docs": [
            "Lender share token. Same decimals as USDC so 1 share starts at 1 USDC."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "liquidate",
      "discriminator": [
        223,
        179,
        226,
        125,
        48,
        46,
        39,
        74
      ],
      "accounts": [
        {
          "name": "liquidator",
          "docs": [
            "Anyone can liquidate a loan that is unhealthy or in default; they pay the debt",
            "(or what the collateral covers) and get the collateral at a bonus."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "loan",
          "writable": true
        },
        {
          "name": "borrower",
          "relations": [
            "loan"
          ]
        },
        {
          "name": "borrowerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "borrower"
              }
            ]
          }
        },
        {
          "name": "collateralConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan.collateralMint",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "priceUpdate"
        },
        {
          "name": "borrowerCollateral",
          "writable": true
        },
        {
          "name": "liquidatorCollateral",
          "writable": true
        },
        {
          "name": "liquidatorUsdc",
          "writable": true
        },
        {
          "name": "score",
          "accounts": [
            {
              "name": "whitelist"
            },
            {
              "name": "reputation",
              "writable": true
            },
            {
              "name": "sasSigner"
            },
            {
              "name": "credential"
            },
            {
              "name": "schema"
            },
            {
              "name": "attestation",
              "writable": true
            },
            {
              "name": "sasProgram"
            },
            {
              "name": "trusttrailProgram",
              "address": "BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s"
            }
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "repay",
      "discriminator": [
        234,
        103,
        67,
        82,
        208,
        234,
        219,
        166
      ],
      "accounts": [
        {
          "name": "borrower",
          "writable": true,
          "signer": true,
          "relations": [
            "loan"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "loan",
          "writable": true
        },
        {
          "name": "borrowerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "borrower"
              }
            ]
          }
        },
        {
          "name": "collateralConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan.collateralMint",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "borrowerCollateral",
          "writable": true
        },
        {
          "name": "borrowerUsdc",
          "writable": true
        },
        {
          "name": "score",
          "accounts": [
            {
              "name": "whitelist"
            },
            {
              "name": "reputation",
              "writable": true
            },
            {
              "name": "sasSigner"
            },
            {
              "name": "credential"
            },
            {
              "name": "schema"
            },
            {
              "name": "attestation",
              "writable": true
            },
            {
              "name": "sasProgram"
            },
            {
              "name": "trusttrailProgram",
              "address": "BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s"
            }
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "lender",
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lenderUsdc",
          "writable": true
        },
        {
          "name": "lenderLp",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "borrowerState",
      "discriminator": [
        160,
        47,
        174,
        209,
        255,
        213,
        193,
        235
      ]
    },
    {
      "name": "collateralConfig",
      "discriminator": [
        150,
        147,
        210,
        201,
        79,
        202,
        93,
        49
      ]
    },
    {
      "name": "loan",
      "discriminator": [
        20,
        195,
        70,
        117,
        165,
        227,
        182,
        1
      ]
    },
    {
      "name": "poolConfig",
      "discriminator": [
        26,
        108,
        14,
        123,
        116,
        230,
        129,
        43
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "zeroShares",
      "msg": "Deposit too small to mint any shares"
    },
    {
      "code": 6002,
      "name": "insufficientLiquidity",
      "msg": "Not enough idle USDC in the pool"
    },
    {
      "code": 6003,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6004,
      "name": "loanTooLarge",
      "msg": "Loan is above this wallet's limit"
    },
    {
      "code": 6005,
      "name": "collateralNotAllowed",
      "msg": "This collateral needs a higher tier"
    },
    {
      "code": 6006,
      "name": "insufficientCollateral",
      "msg": "Collateral is worth less than the tier requires"
    },
    {
      "code": 6007,
      "name": "invalidPriceAccount",
      "msg": "Price account is not a valid Pyth price update"
    },
    {
      "code": 6008,
      "name": "wrongPriceFeed",
      "msg": "Price is for a different asset"
    },
    {
      "code": 6009,
      "name": "stalePrice",
      "msg": "Price is too old"
    },
    {
      "code": 6010,
      "name": "loanNotOpen",
      "msg": "This loan is already closed"
    },
    {
      "code": 6011,
      "name": "wrongLoan",
      "msg": "Account does not belong to this loan"
    },
    {
      "code": 6012,
      "name": "notLiquidatable",
      "msg": "Loan is healthy and not in default, so it cannot be liquidated"
    },
    {
      "code": 6013,
      "name": "invalidRiskParams",
      "msg": "Liquidation threshold and bonus do not fit together"
    },
    {
      "code": 6014,
      "name": "borrowCapReached",
      "msg": "The pool keeps 10% free for withdrawals; this loan would go past that"
    }
  ],
  "types": [
    {
      "name": "borrowerState",
      "docs": [
        "Per-borrower state kept by the pool."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "largestRepaid",
            "docs": [
              "Biggest loan repaid on time; the next loan may be at most twice this."
            ],
            "type": "u64"
          },
          {
            "name": "nextLoanId",
            "docs": [
              "Used in the next Loan's seeds; goes up by one per loan."
            ],
            "type": "u64"
          },
          {
            "name": "openLoans",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "collateralConfig",
      "docs": [
        "One accepted collateral token, added by the admin."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Token account (owned by the pool PDA) that holds this collateral."
            ],
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "docs": [
              "Pyth feed id this collateral is priced with (e.g. SOL/USD)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "minTier",
            "docs": [
              "Lowest tier allowed to post it (0 = everyone)."
            ],
            "type": "u8"
          },
          {
            "name": "maxAgeSecs",
            "docs": [
              "A price older than this is refused."
            ],
            "type": "u32"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "liqThresholdBps",
            "docs": [
              "Liquidatable once the collateral is worth less than this share of the debt (e.g. 11_000 = 110%)."
            ],
            "type": "u16"
          },
          {
            "name": "liqBonusBps",
            "docs": [
              "The liquidator gets collateral worth the debt plus this share (e.g. 500 = 5%)."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "loan",
      "docs": [
        "One loan. Its address is also the SAS attestation nonce at repay."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "tierAtOpen",
            "type": "u8"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "indexAtOpen",
            "docs": [
              "Tier's borrow index when the loan opened."
            ],
            "type": "u128"
          },
          {
            "name": "scaledDebt",
            "docs": [
              "principal × WAD ÷ index_at_open, rounded up."
            ],
            "type": "u128"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "collateralAmount",
            "type": "u64"
          },
          {
            "name": "collateralRatioBps",
            "type": "u16"
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
            "name": "status",
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
      "name": "poolConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "totalBorrowed",
            "docs": [
              "USDC owed by all borrowers right now, including accrued interest."
            ],
            "type": "u64"
          },
          {
            "name": "protocolFees",
            "docs": [
              "Protocol's cut of interest (reserve factor). Not owned by lenders."
            ],
            "type": "u64"
          },
          {
            "name": "lastAccrual",
            "docs": [
              "Last time interest was accrued."
            ],
            "type": "i64"
          },
          {
            "name": "tierIndex",
            "docs": [
              "One borrow index per tier, WAD = 1.0. Debt = scaled_debt × index."
            ],
            "type": {
              "array": [
                "u128",
                4
              ]
            }
          },
          {
            "name": "tierScaledDebt",
            "docs": [
              "Σ principal × WAD ÷ index_at_open, per tier."
            ],
            "type": {
              "array": [
                "u128",
                4
              ]
            }
          },
          {
            "name": "tierSpreadBps",
            "type": {
              "array": [
                "i16",
                4
              ]
            }
          },
          {
            "name": "reserveFactorBps",
            "type": "u16"
          },
          {
            "name": "badDebt",
            "docs": [
              "Debt written off that the fee reserve could not cover: the lenders' loss."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "lpMintBump",
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
    }
  ],
  "constants": [
    {
      "name": "borrowerSeed",
      "type": "bytes",
      "value": "[98, 111, 114, 114, 111, 119, 101, 114]"
    },
    {
      "name": "collateralSeed",
      "type": "bytes",
      "value": "[99, 111, 108, 108, 97, 116, 101, 114, 97, 108]"
    },
    {
      "name": "collVaultSeed",
      "type": "bytes",
      "value": "[99, 111, 108, 108]"
    },
    {
      "name": "loanSeed",
      "type": "bytes",
      "value": "[108, 111, 97, 110]"
    },
    {
      "name": "lpMintSeed",
      "type": "bytes",
      "value": "[108, 112]"
    },
    {
      "name": "poolSeed",
      "type": "bytes",
      "value": "[112, 111, 111, 108]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
