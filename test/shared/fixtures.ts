import { Contract, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { defaultAbiCoder } from 'ethers/utils'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals, expandToDecimals } from './utilities'

import ERC20 from '../../build/ERC20.json'
import DXswapFactory from '../../build/DXswapFactory.json'
import DXswapPair from '../../build/DXswapPair.json'
import DXswapDeployer from '../../build/DXswapDeployer.json'
import DXswapFeeSetter from '../../build/DXswapFeeSetter.json'
import DXswapFeeReceiver from '../../build/DXswapFeeReceiver.json'
import RewardManagerMock from '../../build/RewardManagerMock.json'

interface FactoryFixture {
  factory: Contract
  feeSetter: Contract
  feeReceiver: Contract
  honeyToken: Contract
  hsfToken: Contract
}

const overrides = {
  gasLimit: 9999999
}

export async function factoryFixture(provider: Web3Provider, [dxdao, ethReceiver]: Wallet[]): Promise<FactoryFixture> {
  const honeyToken = await deployContract(dxdao, ERC20, [expandTo18Decimals(1000)])
  const hsfToken = await deployContract(dxdao, ERC20, [expandTo18Decimals(1000)])
  const dxSwapDeployer = await deployContract(
    dxdao, DXswapDeployer, [ dxdao.address, [], [], [], honeyToken.address, hsfToken.address,
      ethReceiver.address, ethReceiver.address, expandToDecimals(5, 9)], overrides
  )
  await dxdao.sendTransaction({to: dxSwapDeployer.address, gasPrice: 0, value: 1})
  const deployTx = await dxSwapDeployer.deploy()
  const deployTxReceipt = await provider.getTransactionReceipt(deployTx.hash);
  const factoryAddress = deployTxReceipt.logs !== undefined
    ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[0].data)[0]
    : null
  const factory = new Contract(factoryAddress, JSON.stringify(DXswapFactory.abi), provider).connect(dxdao)
  const feeSetterAddress = await factory.feeToSetter()
  const feeSetter = new Contract(feeSetterAddress, JSON.stringify(DXswapFeeSetter.abi), provider).connect(dxdao)
  const feeReceiverAddress = await factory.feeTo()
  const feeReceiver = new Contract(feeReceiverAddress, JSON.stringify(DXswapFeeReceiver.abi), provider).connect(dxdao)
  return { factory, feeSetter, feeReceiver, honeyToken, hsfToken }
}

interface PairFixture extends FactoryFixture {
  hsfReceiver: Contract
  token0: Contract
  token1: Contract
  token2: Contract
  pair: Contract
  hnyPairToken1: Contract
  hnyPairToken0: Contract
  hsfHnyPair: Contract
  missingHnyPairPair: Contract
}

export async function pairFixture(provider: Web3Provider, [tokenAndContractOwner, wallet, honeyReceiver]: Wallet[]): Promise<PairFixture> {
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
  const tokenC = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
  const honeyToken = await deployContract(tokenAndContractOwner, ERC20, [expandTo18Decimals(10000)])
  const hsfToken = await deployContract(tokenAndContractOwner, ERC20, [expandTo18Decimals(10000)])
  const hsfReceiver = await deployContract(tokenAndContractOwner, RewardManagerMock)
  const token0 = tokenA.address < tokenB.address ? tokenA : tokenB
  const token1 = token0.address === tokenA.address ? tokenB : tokenA

  const dxSwapDeployer = await deployContract(
    tokenAndContractOwner, DXswapDeployer, [
      tokenAndContractOwner.address,
      [token0.address, token1.address, token0.address, hsfToken.address, tokenC.address],
      [token1.address, honeyToken.address, honeyToken.address,  honeyToken.address, token0.address],
      [15, 15, 15, 15, 15, 15],
      honeyToken.address,
      hsfToken.address,
      honeyReceiver.address,
      hsfReceiver.address,
      expandToDecimals(5, 9)
    ], overrides
  )
  await tokenAndContractOwner.sendTransaction({to: dxSwapDeployer.address, gasPrice: 0, value: 1})
  const deployTx = await dxSwapDeployer.deploy()
  const deployTxReceipt = await provider.getTransactionReceipt(deployTx.hash);
  const factoryAddress = deployTxReceipt.logs !== undefined
    ? defaultAbiCoder.decode(['address'], deployTxReceipt.logs[0].data)[0]
    : null

  const factory = new Contract(factoryAddress, JSON.stringify(DXswapFactory.abi), provider).connect(tokenAndContractOwner)
  const feeSetterAddress = await factory.feeToSetter()
  const feeSetter = new Contract(feeSetterAddress, JSON.stringify(DXswapFeeSetter.abi), provider).connect(tokenAndContractOwner)
  const feeReceiverAddress = await factory.feeTo()
  const feeReceiver = new Contract(feeReceiverAddress, JSON.stringify(DXswapFeeReceiver.abi), provider).connect(tokenAndContractOwner)
  const pair = new Contract(
     await factory.getPair(token0.address, token1.address),
     JSON.stringify(DXswapPair.abi), provider
   ).connect(tokenAndContractOwner)
  const hnyPairToken1 = new Contract(
     await factory.getPair(token1.address, honeyToken.address),
     JSON.stringify(DXswapPair.abi), provider
   ).connect(tokenAndContractOwner)
  const hnyPairToken0 = new Contract(
    await factory.getPair(token0.address, honeyToken.address),
    JSON.stringify(DXswapPair.abi), provider
  ).connect(tokenAndContractOwner)
  const hsfHnyPair = new Contract(
    await factory.getPair(hsfToken.address, honeyToken.address),
    JSON.stringify(DXswapPair.abi), provider
  ).connect(tokenAndContractOwner)
  const missingHnyPairPair = new Contract(
    await factory.getPair(tokenC.address, token0.address),
    JSON.stringify(DXswapPair.abi), provider
  ).connect(tokenAndContractOwner)

  return { factory, feeSetter, feeReceiver, honeyToken, hsfToken, hsfReceiver, token0, token1, token2: tokenC, pair, hnyPairToken1,
    hnyPairToken0, hsfHnyPair, missingHnyPairPair }
}
