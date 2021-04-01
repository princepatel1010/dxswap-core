const HDWalletProvider = require('@truffle/hdwallet-provider')
require('dotenv').config();

mnemonic = process.env.KEY_MNEMONIC;
privateKey = process.env.ETH_KEY;
infuraApiKey = process.env.KEY_INFURA_API_KEY;

module.exports = {
  networks: {
    rpc: {
      network_id: '*',
      host: 'localhost',
      port: 8545,
      gas: 12000000,
      gasPrice: 10000000000 //10 Gwei
    },
    develop: {
      network_id: '66',
      host: 'localhost',
      port: 8545,
      gas: 12000000,
      gasPrice: 10000000000 //10 Gwei
    },
    mainnet: {
      provider: function () {
        return new HDWalletProvider(mnemonic, `https://mainnet.infura.io/v3/${infuraApiKey}`)
      },
      network_id: '1',
      gas: 9000000,
      gasPrice: 10000000000 //10 Gwei
    },
    rinkeby: {
      provider: () => new HDWalletProvider([privateKey], `https://rinkeby.infura.io/v3/${infuraApiKey}`),
      network_id: '4',
      gas: 9000000,
      gasPrice: 2000000000, //2 Gwei,
      skipDryRun: true
    },
    ropsten: {
      provider: function () {
        return new HDWalletProvider(mnemonic, `https://ropsten.infura.io/v3/${infuraApiKey}`)
      },
      network_id: '3',
      gas: 8000000,
      gasPrice: 10000000000 //10 Gwei
    },
    kovan: {
      provider: function () {
        return new HDWalletProvider(mnemonic, `https://kovan.infura.io/v3/${infuraApiKey}`)
      },
      network_id: '42',
      gas: 9000000,
      gasPrice: 10000000000 //10 Gwei
    },
    arbitrumTestnetV3: {
      provider: function() {
        return wrapProvider(new HDWalletProvider(mnemonic, 'https://kovan3.arbitrum.io/rpc'))
      },
      network_id: '79377087078960',
      gas: 9000000,
      gasPrice: 10000000000 //10 Gwei
    },
    matic: {
      provider: () => new HDWalletProvider([privateKey], `https://rpc-mainnet.maticvigil.com/`),
      network_id: 137,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true,
      gasPrice: 1000000000, // 1 Gwei
      gas: 20000000
    },
  },
  build: {},
  compilers: {
    solc: {
      version: '0.5.16',
      settings: {
        evmVersion: 'istanbul',
      }
    }
  },
  solc: {
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
}
