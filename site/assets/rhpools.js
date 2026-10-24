// Robinhood Chain stock tokens and the pool each one is priced from (the deepest pool for that token when this table
// was built by dev/rhprobe.mjs). v3 pools are read through slot0() and liquidity(); v4 pools live in the PoolManager
// and are read with extsload() at keccak256(poolId, 6) (slot0) and that slot + 3 (liquidity). Addresses are the
// official tokens; look-alike contracts with vanity addresses exist, so the list is fixed.
export const RPC = 'https://robinhood-rpc.publicnode.com';
export const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
export const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
export const ETH_USDG = { pool: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca', weth0: true, dWeth: 18, dUsdg: 6 };
export const RH_STOCKS = [
  {
    sym: "NVDA",
    name: "NVIDIA",
    addr: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    quote: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    v4: false,
    pool: "0x62ab521f71431f78ac374cdbadc6cda3c8916b6c",
    slot: null,
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "TSLA",
    name: "Tesla",
    addr: "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
    quote: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    v4: true,
    pool: "0x3ea70ce0b34473692549f97e630a1d82dc05cea94fa55f81b50f10c8c6d8186f",
    slot: "0x292718f2f31c4975c915c178603d62166fda3b91cfaf895ef92abbfa5bff74f0",
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "AAPL",
    name: "Apple",
    addr: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    quote: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    v4: false,
    pool: "0x8bb3514e2204e1cdf3ac149efee7ff04d91b719f",
    slot: null,
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "META",
    name: "Meta",
    addr: "0xc0d6457c16cc70d6790dd43521c899c87ce02f35",
    quote: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    v4: true,
    pool: "0x8dc0387af606d84be8e4c2fc1da7bdc6d467337e9f3e075113f968922a190847",
    slot: "0x7854508e54a57cabe5501f4d08d25056ce2ce041d60ef69d68f05e556f1ec443",
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "GOOGL",
    name: "Alphabet",
    addr: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3",
    quote: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    v4: false,
    pool: "0x34d0dc122cf9a8eb296fc5e0d3a233625d7d19b7",
    slot: null,
    stock0: true,
    dStock: 18,
    dQuote: 6
  },
  {
    sym: "AMZN",
    name: "Amazon",
    addr: "0x12f190a9f9d7d37a250758b26824b97ce941bf54",
    quote: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    v4: true,
    pool: "0x68beff3b4270ffbbb78a48d7670648909b9de6736456b0f450fee242e1d10a8b",
    slot: "0xcc91a5ea9b2055cbae6bcd7c8852ab1308ec8edd24dca992f89378358dab3108",
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "MSFT",
    name: "Microsoft",
    addr: "0xe93237c50d904957cf27e7b1133b510c669c2e74",
    quote: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    v4: true,
    pool: "0x18074ca08154f613c70444ef22793ff1875e9bdc92bab25a5ee0f39107c77258",
    slot: "0x1e17c750dfe15e600b3f11834a44128e750622287fccd5c3ff3429764a1a91af",
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "AMD",
    name: "AMD",
    addr: "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc",
    quote: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    v4: true,
    pool: "0xe6e17efdbdd916526293cf1b509171be4ffb04f47c4a5fe1a7367acdaa6ffd82",
    slot: "0x512a94217c61ba03bfd479ca36cc70d11e86d7649a8a052ce7918d71c050bd4e",
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "COIN",
    name: "Coinbase",
    addr: "0x6330d8c3178a418788df01a47479c0ce7ccf450b",
    quote: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    v4: false,
    pool: "0x04f3a0eb5d782a2f63870a029e3916f5d0d03d24",
    slot: null,
    stock0: false,
    dStock: 18,
    dQuote: 6
  },
  {
    sym: "PLTR",
    name: "Palantir",
    addr: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a",
    quote: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    v4: true,
    pool: "0xb8d9b6b622bb03dd06d95790553f327710a73d85d845a59fa9e652638ca96ae6",
    slot: "0xaa9dc192887dd18118cc3a1eab9bcc9f70b74ec46197837dee3ce78678d87d47",
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "MSTR",
    name: "Strategy",
    addr: "0xec262a75e413fafd0df80480274532c79d42da09",
    quote: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    v4: true,
    pool: "0x319bac87e616a89e241c10aeb8afd4892a852cdd8b373cd9765ecddc40b87cfe",
    slot: "0x36bb9232793cb94ec65567add205fcb8e762921e457c591f7311f624bf87a55f",
    stock0: false,
    dStock: 18,
    dQuote: 6
  },
  {
    sym: "SPY",
    name: "S&P 500 ETF",
    addr: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    quote: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    v4: false,
    pool: "0xddcbba3666f578e3f09516f21ff85bfee859ab5e",
    slot: null,
    stock0: false,
    dStock: 18,
    dQuote: 18
  },
  {
    sym: "QQQ",
    name: "Nasdaq 100 ETF",
    addr: "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68",
    quote: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
    v4: true,
    pool: "0x8493982435e4273028008cd181c84c0d6a548f96792fdb5acddcbb6a8c82d305",
    slot: "0x495ec886b553a67e4d232c1e8d5c75f81166634eeee9d44795b4f9b2032ece37",
    stock0: false,
    dStock: 18,
    dQuote: 18
  }
];
