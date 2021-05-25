import chai, {expect} from 'chai'
import {Contract} from 'ethers'
import {AddressZero} from 'ethers/constants'
import {BigNumber, bigNumberify} from 'ethers/utils'
import {solidity, MockProvider, createFixtureLoader, deployContract} from 'ethereum-waffle'

import {expandTo18Decimals, expandToDecimals, getCreate2Address} from './shared/utilities'
import {pairFixture} from './shared/fixtures'

import DXswapPair from '../build/DXswapPair.json'
import ERC20 from '../build/ERC20.json'
import DXswapFeeReceiver from '../build/DXswapFeeReceiver.json'

const FEE_DENOMINATOR = bigNumberify(10).pow(4)
const ROUND_EXCEPTION = bigNumberify(10).pow(4)
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD"

chai.use(solidity)

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000'
]

describe('DXswapFeeReceiver', () => {
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
    const [reserve0, reserve1] = await pair.getReserves()
    const token0 = await pair.token0()
    return getAmountOutSync(reserve0, reserve1, token0 === tokenIn, amountIn, await pair.swapFee())
  }

  function getAmountOutSync(
    reserve0: BigNumber, reserve1: BigNumber, usingToken0: boolean, amountIn: BigNumber, swapFee: BigNumber
  ) {
    const tokenInBalance = usingToken0 ? reserve0 : reserve1
    const tokenOutBalance = usingToken0 ? reserve1 : reserve0
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
        const denominator = 10 ** (Number(Math.log10(Math.sqrt((token0Reserve).mul(token1Reserve))).toFixed(0)) - 18);
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

  let factory: Contract, token0: Contract, token1: Contract, token2: Contract, honeyToken: Contract, hsfToken: Contract,
    hsfReceiver: Contract, pair: Contract, hnyPairToken0: Contract, hnyPairToken1: Contract, hsfHnyPair: Contract,
    missingHnyPairPair: Contract, feeSetter: Contract, feeReceiver: Contract

  beforeEach(async () => {
    const fixture = await loadFixture(pairFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    token2 = fixture.token2
    honeyToken = fixture.honeyToken
    hsfToken = fixture.hsfToken
    hsfReceiver = fixture.hsfReceiver
    pair = fixture.pair
    hnyPairToken1 = fixture.hnyPairToken1
    hnyPairToken0 = fixture.hnyPairToken0
    hsfHnyPair = fixture.hsfHnyPair
    missingHnyPairPair = fixture.missingHnyPairPair
    feeSetter = fixture.feeSetter
    feeReceiver = fixture.feeReceiver

    console.log("Copy this to the fee receiver init code hash: ", await factory.INIT_CODE_PAIR_HASH())
  })

  it('should claim honey and hsf tokens from erc20-erc20 pair', async () => {
    const tokenAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(10);

    await addLiquidity(pair, token0, token1, tokenAmount, tokenAmount)
    await addLiquidity(hnyPairToken0, token0, honeyToken, tokenAmount, tokenAmount)
    await addLiquidity(hnyPairToken1, token1, honeyToken, tokenAmount, tokenAmount)
    await addLiquidity(hsfHnyPair, hsfToken, honeyToken, tokenAmount, tokenAmount)

    await swapTokens(pair, token0, amountIn, true)
    await swapTokens(pair, token1, amountIn, false)

    const protocolFeeToReceive = await calcProtocolFee(pair);

    await addLiquidity(pair, token0, token1, expandTo18Decimals(10), expandTo18Decimals(10)) // Transfers earned LP's to feeReceiver

    const protocolFeeLPTokensReceived = await pair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokensReceived.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const token0FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply())
    const token1FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply())

    const hnyFromToken0FromProtocolFee = await getAmountOut(hnyPairToken0, token0.address, token0FromProtocolFee)
    const hnyFromToken1FromProtocolFee = await getAmountOut(hnyPairToken1, token1.address, token1FromProtocolFee)
    const totalHnyEarned = hnyFromToken0FromProtocolFee.add(hnyFromToken1FromProtocolFee)
    const fractionalHnyEarned = totalHnyEarned.div(2) // Fixture sets honey split to 50%
    const hsfFromHnyEarned = await getAmountOut(hsfHnyPair, hsfToken.address, totalHnyEarned.div(2)) // Fixture sets hsf split to 50%
    const halfHsfFromHnyEarned = hsfFromHnyEarned.div(2)

    await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

    expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await honeyToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await hsfToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)

    expect((await honeyToken.balanceOf(convertedFeeReceiver.address))).to.be.eq(fractionalHnyEarned)
    expect((await hsfToken.balanceOf(hsfReceiver.address))).to.be.eq(halfHsfFromHnyEarned)
    expect((await hsfToken.balanceOf(BURN_ADDRESS))).to.be.eq(halfHsfFromHnyEarned)
  })

  it('should claim honey and hsf tokens from erc20-erc20 pair with alternative honey-hsf split', async () => {
    const tokenAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(10);

    await addLiquidity(pair, token0, token1, tokenAmount, tokenAmount)
    await addLiquidity(hnyPairToken0, token0, honeyToken, tokenAmount, tokenAmount)
    await addLiquidity(hnyPairToken1, token1, honeyToken, tokenAmount, tokenAmount)
    await addLiquidity(hsfHnyPair, hsfToken, honeyToken, tokenAmount, tokenAmount)

    await swapTokens(pair, token0, amountIn, true)
    await swapTokens(pair, token1, amountIn, false)

    const protocolFeeToReceive = await calcProtocolFee(pair);

    await addLiquidity(pair, token0, token1, expandTo18Decimals(10), expandTo18Decimals(10)) // Transfers earned LP's to feeReceiver

    const protocolFeeLPTokensReceived = await pair.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokensReceived.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const token0FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token0.balanceOf(pair.address)).div(await pair.totalSupply())
    const token1FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token1.balanceOf(pair.address)).div(await pair.totalSupply())

    const hnyFromToken0FromProtocolFee = await getAmountOut(hnyPairToken0, token0.address, token0FromProtocolFee)
    const hnyFromToken1FromProtocolFee = await getAmountOut(hnyPairToken1, token1.address, token1FromProtocolFee)
    const totalHnyEarned = hnyFromToken0FromProtocolFee.add(hnyFromToken1FromProtocolFee)
    const fractionalHnyEarned = totalHnyEarned.div(10) // Fixture sets honey split to 50%
    const hsfFromHnyEarned = await getAmountOut(hsfHnyPair, hsfToken.address, totalHnyEarned.sub(totalHnyEarned.div(10))) // Fixture sets hsf split to 50%
    const halfHsfFromHnyEarned = hsfFromHnyEarned.div(2)

    await feeReceiver.changeSplitHoneyProportion(expandToDecimals(1, 9)) // 10% converted to Honey, 90% converted to HSF
    await feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)

    expect(await token0.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await honeyToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await hsfToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await pair.balanceOf(feeReceiver.address)).to.eq(0)

    expect((await honeyToken.balanceOf(convertedFeeReceiver.address))).to.be.eq(fractionalHnyEarned)
    expect((await hsfToken.balanceOf(hsfReceiver.address))).to.be.eq(halfHsfFromHnyEarned)
    expect((await hsfToken.balanceOf(BURN_ADDRESS))).to.be.eq(halfHsfFromHnyEarned)
  })

  it('should claim honey and hsf tokens from hny-erc20 pair', async () => {
    const tokenAmount = expandTo18Decimals(100);
    const wethAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(10);

    await addLiquidity(hnyPairToken1, token1, honeyToken, tokenAmount, wethAmount)
    await addLiquidity(hsfHnyPair, hsfToken, honeyToken, tokenAmount, wethAmount)
    const token1IsFirstToken = (token1.address < honeyToken.address)
    await swapTokens(hnyPairToken1, token1, amountIn, token1IsFirstToken)
    await swapTokens(hnyPairToken1, honeyToken, amountIn, !token1IsFirstToken)

    const protocolFeeToReceive = await calcProtocolFee(hnyPairToken1);

    await addLiquidity(hnyPairToken1, token1, honeyToken, expandTo18Decimals(10), expandTo18Decimals(10))
    const protocolFeeLPTokensReceived = await hnyPairToken1.balanceOf(feeReceiver.address);
    expect(protocolFeeLPTokensReceived.div(ROUND_EXCEPTION))
      .to.be.eq(protocolFeeToReceive.div(ROUND_EXCEPTION))

    const token1FromProtocolFee = protocolFeeLPTokensReceived
      .mul(await token1.balanceOf(hnyPairToken1.address)).div(await hnyPairToken1.totalSupply());
    const hnyFromProtocolFee = protocolFeeLPTokensReceived
      .mul(await honeyToken.balanceOf(hnyPairToken1.address)).div(await hnyPairToken1.totalSupply());

    const token1ReserveBeforeSwap = (await token1.balanceOf(hnyPairToken1.address)).sub(token1FromProtocolFee)
    const hnyReserveBeforeSwap = (await honeyToken.balanceOf(hnyPairToken1.address)).sub(hnyFromProtocolFee)
    const hnyFromToken1FromProtocolFee = await getAmountOutSync(
      token1IsFirstToken ? token1ReserveBeforeSwap : hnyReserveBeforeSwap,
      token1IsFirstToken ? hnyReserveBeforeSwap : token1ReserveBeforeSwap,
      token1IsFirstToken,
      token1FromProtocolFee,
      await hnyPairToken1.swapFee()
    );

    const totalHnyEarned = hnyFromProtocolFee.add(hnyFromToken1FromProtocolFee)
    const honeyEarned = totalHnyEarned.div(2); // Fixture sets honey split to 50%
    const hsfFromHnyEarned = await getAmountOut(hsfHnyPair, hsfToken.address, totalHnyEarned.div(2)); // Fixture sets hsf split to 50%
    const halfHsfFromHnyEarned = hsfFromHnyEarned.div(2)

    await feeReceiver.connect(wallet).takeProtocolFee([hnyPairToken1.address], overrides)

    expect(await token1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await honeyToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await hsfToken.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await hnyPairToken1.balanceOf(feeReceiver.address)).to.eq(0)
    expect(await token1.balanceOf(tokenAndContractOwner.address)).to.be.eq(0)

    expect((await honeyToken.balanceOf(convertedFeeReceiver.address))).to.be.eq(honeyEarned)
    expect((await hsfToken.balanceOf(hsfReceiver.address))).to.be.eq(halfHsfFromHnyEarned)
    expect((await hsfToken.balanceOf(BURN_ADDRESS))).to.be.eq(halfHsfFromHnyEarned)
  })

  it('should revert when token0-hny pair has no liquidity', async () => {
    const tokenAmount = expandTo18Decimals(100);
    const wethAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(10);

    await addLiquidity(pair, token0, token1, tokenAmount, tokenAmount)
    await addLiquidity(hnyPairToken1, token1, honeyToken, tokenAmount, wethAmount)
    await addLiquidity(hsfHnyPair, hsfToken, honeyToken, tokenAmount, wethAmount)

    await swapTokens(pair, token0, amountIn, true)
    await swapTokens(pair, token1, amountIn, false)

    await addLiquidity(pair, token0, token1, expandTo18Decimals(10), expandTo18Decimals(10)) // Transfers earned LP's to feeReceiver

    await expect(feeReceiver.connect(wallet).takeProtocolFee([pair.address], overrides)).to.be.revertedWith('DXswapFeeReceiver: INSUFFICIENT_LIQUIDITY')
  })

  it('should revert when there is no token-hny pair', async () => {
    const tokenAmount = expandTo18Decimals(100);
    const wethAmount = expandTo18Decimals(100);
    const amountIn = expandTo18Decimals(10);

    await addLiquidity(missingHnyPairPair, token0, token2, tokenAmount, tokenAmount)
    await addLiquidity(hnyPairToken0, token0, honeyToken, tokenAmount, wethAmount)
    await addLiquidity(hsfHnyPair, hsfToken, honeyToken, tokenAmount, wethAmount)

    await swapTokens(missingHnyPairPair, token0, amountIn, true)
    await swapTokens(missingHnyPairPair, token2, amountIn, false)

    await addLiquidity(missingHnyPairPair, token0, token2, expandTo18Decimals(10), expandTo18Decimals(10)) // Transfers earned LP's to feeReceiver

    await expect(feeReceiver.connect(wallet).takeProtocolFee([missingHnyPairPair.address], overrides)).to.be.revertedWith('DXswapFeeReceiver: NO_HONEY_PAIR')
  })

  it('should only allow owner to transfer ownership', async () => {
    await expect(feeReceiver.connect(other).transferOwnership(other.address))
      .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
    await feeReceiver.connect(tokenAndContractOwner).transferOwnership(other.address);
    expect(await feeReceiver.owner()).to.be.eq(other.address)
  })

  it('should only allow owner to change receivers', async () => {
    await expect(feeReceiver.connect(other).changeReceivers(other.address, other.address))
      .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
    await feeReceiver.connect(tokenAndContractOwner).changeReceivers(other.address, other.address);
    expect(await feeReceiver.honeyReceiver()).to.be.eq(other.address)
    expect(await feeReceiver.hsfReceiver()).to.be.eq(other.address)
  })

  it('should only allow owner to change split honey proportion', async () => {
    const newSplitHoneyProportion = expandToDecimals(1, 9)
    await expect(feeReceiver.connect(other).changeSplitHoneyProportion(newSplitHoneyProportion))
      .to.be.revertedWith('DXswapFeeReceiver: FORBIDDEN')
    await expect(feeReceiver.connect(tokenAndContractOwner).changeSplitHoneyProportion(expandToDecimals(6, 9)))
      .to.be.revertedWith('DXswapFeeReceiver: HONEY_PROPORTION_TOO_HIGH');
    await feeReceiver.connect(tokenAndContractOwner).changeSplitHoneyProportion(newSplitHoneyProportion);
    expect(await feeReceiver.splitHoneyProportion()).to.be.eq(newSplitHoneyProportion)
  })
})
