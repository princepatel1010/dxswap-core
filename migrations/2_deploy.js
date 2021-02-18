const DXswapDeployer = artifacts.require('DXswapDeployer.sol')
const ERC20 = artifacts.require('ERC20.sol')
const WETH = artifacts.require('WETH9.sol')

const argValue = (arg, defaultValue) => process.argv.includes(arg) ? process.argv[process.argv.indexOf(arg) + 1] : defaultValue
const network = () => argValue('--network', 'local')

module.exports = async function (deployer) {
    const BN = web3.utils.toBN
    const bnWithDecimals = (number, decimals) => BN(number).mul(BN(10).pow(BN(decimals)))
    const senderAccount = (await web3.eth.getAccounts())[0]
    const FIFTY_PERCENT = bnWithDecimals(5, 9)

    // if (network() === 'rinkeby') {

    const hnyToken = await deployer.deploy(ERC20, BN(1000))
    const hsfToken = await deployer.deploy(ERC20, BN(1000))
    const wNative = await deployer.deploy(WETH)

    const dxSwapDeployer = await deployer.deploy(DXswapDeployer, senderAccount, wNative.address, [hnyToken.address],
      [hsfToken.address], [15], hnyToken.address, hsfToken.address, senderAccount, senderAccount, FIFTY_PERCENT)
    await dxSwapDeployer.send(1)
    const deployTx = await dxSwapDeployer.deploy()
    
    // }
}
