const DXswapDeployer = artifacts.require('DXswapDeployer.sol')
const DXswapFactory = artifacts.require('DXswapFactory')
const ERC20 = artifacts.require('ERC20.sol')

const argValue = (arg, defaultValue) => process.argv.includes(arg) ? process.argv[process.argv.indexOf(arg) + 1] : defaultValue
const network = () => argValue('--network', 'local')
const HONEY_ON_MATIC = "0xb371248Dd0f9E4061ccf8850E9223Ca48Aa7CA4b"
const WETH_ON_MATIC = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"

module.exports = async (deployer) => {
    const BN = web3.utils.toBN
    const bnWithDecimals = (number, decimals) => BN(number).mul(BN(10).pow(BN(decimals)))
    const senderAccount = (await web3.eth.getAccounts())[0]

    if (network() === 'rinkeby') {
        const FIFTY_PERCENT = bnWithDecimals(5, 9)
        const hnyToken = await deployer.deploy(ERC20, bnWithDecimals(1000000, 18))
        const hsfToken = await deployer.deploy(ERC20, bnWithDecimals(1000000, 18))

        const dxSwapDeployer = await deployer.deploy(DXswapDeployer, senderAccount, [hnyToken.address],
          [hsfToken.address], [15], hnyToken.address, hsfToken.address, senderAccount, senderAccount, FIFTY_PERCENT)
        await dxSwapDeployer.send(1, {from: senderAccount})
        console.log("Sent deployment reimbursement")
        await dxSwapDeployer.deploy({from: senderAccount})
        console.log("Deployed dxSwap")

    } else if (network() === 'matic') {

        // const hnyToken = await deployer.deploy(ERC20, bnWithDecimals(1000000, 18))
        // const hsfToken = await deployer.deploy(ERC20, bnWithDecimals(1000000, 18))

        const dxSwapFactory = await deployer.deploy(DXswapFactory, senderAccount, WETH_ON_MATIC)
        console.log("Pair init code hash: ", await dxSwapFactory.INIT_CODE_PAIR_HASH())
    }
}
