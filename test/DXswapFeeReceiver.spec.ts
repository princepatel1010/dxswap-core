import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero } from 'ethers/constants'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import {expandTo18Decimals, expandToDecimals, getCreate2Address} from './shared/utilities'
import { pairFixture } from './shared/fixtures'

import DXswapPair from '../build/DXswapPair.json'
import ERC20 from '../build/ERC20.json'
import DXswapFeeReceiver from '../build/DXswapFeeReceiver.json'

const FEE_DENOMINATOR = bigNumberify(10).pow(4)
const ROUND_EXCEPTION = bigNumberify(10).pow(4)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

chai.use(solidity)

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000'
]

describe.only('DXswapFeeReceiver', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 18000000
  })
  const overrides = {
    gasLimit: 18000000
  }
  const [tokenAndContractOwner, wallet, convertedFeeReceiver, other] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [tokenAndContractOwner, wallet, convertedFeeReceiver])

  async function getAmountOut(pair: Contract, tokenIn: string, amountIn: BigNumber) {
    const [ reserve0, reserve1 ] = await pair.getReserves()
    const token0 = await pair.token0()
    return getAmountOutSync(reserve0, reserve1, token0 === tokenIn, amountIn, await pair.swapFee())
  }

  function getAmountOutSync(
    reserve0: BigNumber, reserve1: BigNumber, usingToken0: boolean, amountIn: BigNumber, swapFee: BigNumber
  ) {
    const tokenInBalance = usingToken0 ? reserve0 : reserve1
    const tokenOutBalance = usingToken0? reserve1 : reserve0
    const amountInWithFee = amountIn.mul(FEE_DENOMINATOR.sub(swapFee))
    return amountInWithFee.mul(tokenOutBalance)
      .div(tokenInBalance.mul(FEE_DENOMINATOR).add(amountInWithFee))
  }

  // Calculate how much will be payed from liquidity as protocol fee in the next mint/burn
  async function calcProtocolFee(pair: Contract) {
    const [token0Reserve, token1Reserve, _] = await pair.getReserves()
    const kLast = await pair.kLast()
    const feeTo = await factory.feeTo()
    const protocolFeeDenominator = await factory.protocolFeeDenominator()
    const totalSupply = await pair.totalSupply()
    let rootK, rootKLast;
    if (feeTo != AddressZero) {
      // Check for math overflow when dealing with big big balances
      if (Math.sqrt((token0Reserve).mul(token1Reserve)) > Math.pow(10, 19)) {
        const denominator = 10 ** ( Number(Math.log10(Math.sqrt((token0Reserve).mul(token1Reserve))).toFixed(0)) - 18);
        rootK = bigNumberify((Math.sqrt(
          token0Reserve.mul(token1Reserve)
        ) / denominator).toString())
        rootKLast = bigNumberify((Math.sqrt(kLast) / denominator).toString())
      } else {
        rootK = bigNumberify(Math.sqrt((token0Reserve).mul(token1Reserve)).toString())
        rootKLast = bigNumberify(Math.sqrt(kLast).toString())
      }

      return (totalSupply.mul(rootK.sub(rootKLast)))
        .div(rootK.mul(protocolFeeDenominator).add(rootKLast))
    } else {
      return bigNumberify(0)
    }
  }

  const addLiquidity = async (pair: Contract, token0: Contract, token1: Contract,
                              token0Amount: BigNumber, token1Amount: BigNumber) => {
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)
    await pair.mint(wallet.address, overrides)
  }

  const swapTokens = async (pair: Contract, tokenIn: Contract, amountIn: BigNumber, firstToken: boolean) => {
    const amountOut = await getAmountOut(pair, tokenIn.address, amountIn);
    await tokenIn.transfer(pair.address, amountIn)
    firstToken ?
      await pair.swap(0, amountOut, wallet.address, '0x', overrides) :
      await pair.swap(amountOut, 0, wallet.address, '0x', overrides)
  }

  let factory: Contract, token0: Contract, token1: Contract, honeyToken: Contract, hsfToken: Contract, pair: Contract
  let wethPairToken0: Contract, wethPairToken1: Contract, honeyWethPair: Contract, hsfWethPair: Contract, WETH: Contract
  let feeSetter: Contract, feeReceiver: Contract

  beforeEach(async () => {
    const fixture = await loadFixture(pairFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    honeyToken = fixture.honeyToken
    hsfToken = fixture.hsfToken
    pair = fixture.pair
    wethPairToken1 = fixture.wethPairToken1
    wethPairToken0 = fixture.wethPairToken0
    honeyWethPair = fixture.honeyWethPair
    hsfWethPair = fixture.hsfWethPair
    WETH = fixture.WETH
    feeSetter = fixture.feeSetter
    feeReceiver = fixture.feeReceiver
  })

  it('should send honey and hsf tokens to converted fee receiver address from token pair', async () => {
    const tokenAmount = expandTo18Decimals(100);
    const wethAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(10);

    await addLiquidity(pair, token0, token1, tokenAmount, tokenAmount)
    await addLiquidity(wethPairToken1, token1, WETH, tokenAmount, wethAmount)
    await addLiquidity(wethPairToken0, token0, WETH, tokenAmount, wethAmount)
    await addLiquidity(honeyWethPair, honeyToken, WETH, tokenAmount, wethAmount)
    await addLiquidity(hsfWethPair, hsfToken, WETH, tokenAmount, wethAmount)

    await swapTokens(pair, token0, amountIn, true)
    await swapTokens(pair, token1, amountIn, false)

    const protocolFeeToReceive = await calcProtocolFee(pair);

    await addLiquidity(pair, token0, token1, expandTo18Decimals(10), expandTo18Decimals(10)) // Transfers earned LP's to feeReceiver

    const protocolFeeLPTokensReceived = await pair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokensReceived.div(ROUND_EXCEPTION))
    .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const token0FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply());
    const token1FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply());

    const wethFromToken0FromProtocolFee = await getAmountOut(wethPairToken0, token0.address, token0FromProtocolFee);
    const wethFromToken1FromProtocolFee = await getAmountOut(wethPairToken1, token1.address, token1FromProtocolFee);
    const totalWethEarned = wethFromToken0FromProtocolFee.add(wethFromToken1FromProtocolFee)
    const honeyFromWethEarned = await getAmountOut(honeyWethPair, honeyToken.address, totalWethEarned.div(2)); // Fixture sets honey split to 50%
    const hsfFromWethEarned = await getAmountOut(hsfWethPair, hsfToken.address, totalWethEarned.div(2)); // Fixture sets hsf split to 50%
    const halfHsfFromWethEarned = hsfFromWethEarned.div(2)

    await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

    expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await honeyToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await hsfToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)

    expect((await honeyToken.balanceOf(convertedFeeReceiver.address))).to.be.eq(honeyFromWethEarned)
    expect((await hsfToken.balanceOf(convertedFeeReceiver.address))).to.be.eq(halfHsfFromWethEarned)
    expect((await hsfToken.balanceOf(ZERO_ADDRESS))).to.be.eq(halfHsfFromWethEarned)
  })

  it.only('should send honey and hsf to converted fee receiver from weth token pair', async () => {
    const tokenAmount = expandTo18Decimals(100);
    const wethAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(10);

    await addLiquidity(wethPairToken1, token1, WETH, tokenAmount, wethAmount)
    await addLiquidity(honeyWethPair, honeyToken, WETH, tokenAmount, wethAmount)
    await addLiquidity(hsfWethPair, hsfToken, WETH, tokenAmount, wethAmount)
    const token1IsFirstToken = (token1.address < WETH.address)
    await swapTokens(wethPairToken1, token1, amountIn, token1IsFirstToken)
    await swapTokens(wethPairToken1, WETH, amountIn, !token1IsFirstToken)

    const protocolFeeToReceive = await calcProtocolFee(wethPairToken1);

    await addLiquidity(wethPairToken1, token1, WETH, expandTo18Decimals(10), expandTo18Decimals(10))
    const protocolFeeLPTokensReceived = await wethPairToken1.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokensReceived.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const token1FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token1.balanceOf(wethPairToken1.address)).div(await wethPairToken1.totalSupply());
    const wethFromProtocolFee = protocolFeeLPTokensReceived
      .mul(await WETH.balanceOf(wethPairToken1.address)).div(await wethPairToken1.totalSupply());

    const token1ReserveBeforeSwap = (await token1.balanceOf(wethPairToken1.address)).sub(token1FromProtocolFee)
    const wethReserveBeforeSwap = (await WETH.balanceOf(wethPairToken1.address)).sub(wethFromProtocolFee)
    const wethFromToken1FromProtocolFee = await getAmountOutSync(
      token1IsFirstToken ? token1ReserveBeforeSwap : wethReserveBeforeSwap,
      token1IsFirstToken ? wethReserveBeforeSwap : token1ReserveBeforeSwap,
      token1IsFirstToken,
      token1FromProtocolFee,
      await wethPairToken1.swapFee()
    );

    const totalWethEarned = wethFromProtocolFee.add(wethFromToken1FromProtocolFee)
    const honeyFromWethEarned = await getAmountOut(honeyWethPair, honeyToken.address, totalWethEarned.div(2)); // Fixture sets honey split to 50%
    const hsfFromWethEarned = await getAmountOut(hsfWethPair, hsfToken.address, totalWethEarned.div(2)); // Fixture sets hsf split to 50%
    const halfHsfFromWethEarned = hsfFromWethEarned.div(2)

    await feeReceiver.connect(wallet).takeProtocolFee([wethPairToken1.address], overrides)

    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await honeyToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await hsfToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await wethPairToken1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await token1.balanceOf(tokenAndContractOwner.address)).to.be.eq(0)

    expect((await honeyToken.balanceOf(convertedFeeReceiver.address))).to.be.eq(honeyFromWethEarned)
    expect((await hsfToken.balanceOf(convertedFeeReceiver.address))).to.be.eq(halfHsfFromWethEarned)
    expect((await hsfToken.balanceOf(ZERO_ADDRESS))).to.be.eq(halfHsfFromWethEarned)
  })

  it(
    'should receive only tokens when extracting fee from tokenA-tokenB pair that has no path to WETH',
    async () =>
  {
    const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
    const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

    const tokenAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(50);

    await factory.createPair(tokenA.address, tokenB.address);
    const tokenATokenBPair = new Contract(
      await factory.getPair(
        (tokenA.address < tokenB.address) ? tokenA.address : tokenB.address,
        (tokenA.address < tokenB.address) ? tokenB.address : tokenA.address
      ), JSON.stringify(DXswapPair.abi), provider
    ).connect(wallet)

    await tokenA.transfer(tokenATokenBPair.address, tokenAmount)
    await tokenB.transfer(tokenATokenBPair.address, tokenAmount)
    await tokenATokenBPair.mint(wallet.address, overrides)

    let amountOut = await getAmountOut(tokenATokenBPair, tokenA.address, amountIn);
    await tokenA.transfer(tokenATokenBPair.address, amountIn)
    await tokenATokenBPair.swap(
      (tokenA.address < tokenB.address) ? 0 : amountOut,
      (tokenA.address < tokenB.address) ? amountOut : 0,
      wallet.address, '0x', overrides
    )

    amountOut = await getAmountOut(tokenATokenBPair, tokenB.address, amountIn);
    await tokenB.transfer(tokenATokenBPair.address, amountIn)
    await tokenATokenBPair.swap(
      (tokenA.address < tokenB.address) ? amountOut : 0,
      (tokenA.address < tokenB.address) ? 0 : amountOut,
      wallet.address, '0x', overrides
    )

    const protocolFeeToReceive = await calcProtocolFee(tokenATokenBPair);

    await tokenA.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
    await tokenB.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
    await tokenATokenBPair.mint(wallet.address, overrides)

    const protocolFeeLPTokenAtokenBPair = await tokenATokenBPair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokenAtokenBPair.div(ROUND_EXCEPTION))
    .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const tokenAFromProtocolFee = protocolFeeLPTokenAtokenBPair
    .mul(await tokenA.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
    const tokenBFromProtocolFee = protocolFeeLPTokenAtokenBPair
    .mul(await tokenB.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());

    const protocolFeeReceiverBalance = await provider.getBalance(convertedFeeReceiver.address)

    await feeReceiver.connect(wallet).takeProtocolFee([tokenATokenBPair.address], overrides)

    expect(await tokenA.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await tokenB.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await tokenATokenBPair.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

    expect((await provider.getBalance(convertedFeeReceiver.address)))
      .to.be.eq(protocolFeeReceiverBalance)
    expect((await tokenA.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(tokenAFromProtocolFee)
    expect((await tokenB.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(tokenBFromProtocolFee)
  })

  it(
    'should receive only tokens when extracting fee from both tokenA-tonkenB pair and tokenC-tokenD pair',
    async () =>
  {
    const tokenAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(50);

    // Set up tokenA-tokenB
    const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
    const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

    await factory.createPair(tokenA.address, tokenB.address);
    const tokenATokenBPair = new Contract(
      await factory.getPair(
        (tokenA.address < tokenB.address) ? tokenA.address : tokenB.address,
        (tokenA.address < tokenB.address) ? tokenB.address : tokenA.address
      ), JSON.stringify(DXswapPair.abi), provider
    ).connect(wallet)

    await tokenA.transfer(tokenATokenBPair.address, tokenAmount)
    await tokenB.transfer(tokenATokenBPair.address, tokenAmount)
    await tokenATokenBPair.mint(wallet.address, overrides)

    let amountOut = await getAmountOut(tokenATokenBPair, tokenA.address, amountIn);
    await tokenA.transfer(tokenATokenBPair.address, amountIn)
    await tokenATokenBPair.swap(
      (tokenA.address < tokenB.address) ? 0 : amountOut,
      (tokenA.address < tokenB.address) ? amountOut : 0,
      wallet.address, '0x', overrides
    )

    amountOut = await getAmountOut(tokenATokenBPair, tokenB.address, amountIn);
    await tokenB.transfer(tokenATokenBPair.address, amountIn)
    await tokenATokenBPair.swap(
      (tokenA.address < tokenB.address) ? amountOut : 0,
      (tokenA.address < tokenB.address) ? 0 : amountOut,
      wallet.address, '0x', overrides
    )

    let protocolFeeToReceive = await calcProtocolFee(tokenATokenBPair);

    await tokenA.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
    await tokenB.transfer(tokenATokenBPair.address, expandTo18Decimals(10))
    await tokenATokenBPair.mint(wallet.address, overrides)

    const protocolFeeLPTokenAtokenBPair = await tokenATokenBPair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokenAtokenBPair.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    // Set up tokenC-tokenD pair
    const tokenC = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
    const tokenD = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

    await factory.createPair(tokenC.address, tokenD.address);
    const tokenCTokenDPair = new Contract(
      await factory.getPair(
        (tokenC.address < tokenD.address) ? tokenC.address : tokenD.address,
        (tokenC.address < tokenD.address) ? tokenD.address : tokenC.address
      ), JSON.stringify(DXswapPair.abi), provider
    ).connect(wallet)

    await tokenC.transfer(tokenCTokenDPair.address, tokenAmount)
    await tokenD.transfer(tokenCTokenDPair.address, tokenAmount)
    await tokenCTokenDPair.mint(wallet.address, overrides)

    amountOut = await getAmountOut(tokenCTokenDPair, tokenC.address, amountIn);
    await tokenC.transfer(tokenCTokenDPair.address, amountIn)
    await tokenCTokenDPair.swap(
      (tokenC.address < tokenD.address) ? 0 : amountOut,
      (tokenC.address < tokenD.address) ? amountOut : 0,
      wallet.address, '0x', overrides
    )

    amountOut = await getAmountOut(tokenCTokenDPair, tokenD.address, amountIn);
    await tokenD.transfer(tokenCTokenDPair.address, amountIn)
    await tokenCTokenDPair.swap(
      (tokenC.address < tokenD.address) ? amountOut : 0,
      (tokenC.address < tokenD.address) ? 0 : amountOut,
      wallet.address, '0x', overrides
    )

    protocolFeeToReceive = await calcProtocolFee(tokenCTokenDPair);

    await tokenC.transfer(tokenCTokenDPair.address, expandTo18Decimals(10))
    await tokenD.transfer(tokenCTokenDPair.address, expandTo18Decimals(10))
    await tokenCTokenDPair.mint(wallet.address, overrides)

    const protocolFeeLPTokenCtokenDPair = await tokenCTokenDPair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokenCtokenDPair.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const tokenAFromProtocolFee = protocolFeeLPTokenAtokenBPair
      .mul(await tokenA.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
    const tokenBFromProtocolFee = protocolFeeLPTokenAtokenBPair
      .mul(await tokenB.balanceOf(tokenATokenBPair.address)).div(await tokenATokenBPair.totalSupply());
    const tokenCFromProtocolFee = protocolFeeLPTokenCtokenDPair
      .mul(await tokenC.balanceOf(tokenCTokenDPair.address)).div(await tokenCTokenDPair.totalSupply());
    const tokenDFromProtocolFee = protocolFeeLPTokenCtokenDPair
      .mul(await tokenD.balanceOf(tokenCTokenDPair.address)).div(await tokenCTokenDPair.totalSupply());

    const protocolFeeReceiverBalance = await provider.getBalance(convertedFeeReceiver.address)

    await feeReceiver.connect(wallet).takeProtocolFee([tokenATokenBPair.address, tokenCTokenDPair.address], overrides)

    expect(await provider.getBalance(convertedFeeReceiver.address)).to.eq(protocolFeeReceiverBalance.toString())

    expect(await tokenA.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await tokenB.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await tokenC.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await tokenD.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

    expect((await provider.getBalance(convertedFeeReceiver.address)))
    .to.be.eq(protocolFeeReceiverBalance)
    expect((await tokenA.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(tokenAFromProtocolFee)
    expect((await tokenB.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(tokenBFromProtocolFee)
    expect((await tokenC.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(tokenCFromProtocolFee)
    expect((await tokenD.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(tokenDFromProtocolFee)
  })

  it(
    'should only allow owner to transfer ownership',
    async () =>
  {
    await expect(feeReceiver.connect(other).transferOwnership(other.address))
      .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
    await feeReceiver.connect(tokenAndContractOwner).transferOwnership(other.address);
    expect(await feeReceiver.owner()).to.be.eq(other.address)
  })

  it(
    'should only allow owner to change receivers',
    async () =>
  {
    await expect(feeReceiver.connect(other).changeReceivers(other.address, other.address))
      .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
    await feeReceiver.connect(tokenAndContractOwner).changeReceivers(other.address, other.address);
    expect(await feeReceiver.ethReceiver()).to.be.eq(other.address)
    expect(await feeReceiver.fallbackReceiver()).to.be.eq(other.address)
  })

  it(
    'should revert with insufficient liquidity error if there is not any liquidity in the WETH pair',
    async () =>
  {
    const tokenAmount = expandTo18Decimals(100);
    const wethAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(50);

    await token0.transfer(pair.address, tokenAmount)
    await token1.transfer(pair.address, tokenAmount)
    await pair.mint(wallet.address, overrides)

    let amountOut = await getAmountOut(pair, token0.address, amountIn);
    await token0.transfer(pair.address, amountIn)
    await pair.swap(0, amountOut, wallet.address, '0x', overrides)

    amountOut = await getAmountOut(pair, token1.address, amountIn);
    await token1.transfer(pair.address, amountIn)
    await pair.swap(amountOut, 0, wallet.address, '0x', overrides)

    const protocolFeeToReceive = await calcProtocolFee(pair);

    await token0.transfer(pair.address, expandTo18Decimals(10))
    await token1.transfer(pair.address, expandTo18Decimals(10))
    await pair.mint(wallet.address, overrides)

    const protocolFeeLPToknesReceived = await pair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPToknesReceived.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const protocolFeeReceiverBalance = await provider.getBalance(convertedFeeReceiver.address)

    await expect(feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)).to.be.revertedWith('DXswapFeeReceiver: INSUFFICIENT_LIQUIDITY')

    expect(await pair.balanceOf(feeReceiver.address)).to.eq(protocolFeeLPToknesReceived)
    expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await WETH.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await provider.getBalance(feeReceiver.address)).to.eq(0)

    expect((await provider.getBalance(convertedFeeReceiver.address)))
      .to.be.eq(protocolFeeReceiverBalance)
    expect((await token0.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(0)
    expect((await token1.balanceOf(tokenAndContractOwner.address)))
      .to.be.eq(0)
  })
})
