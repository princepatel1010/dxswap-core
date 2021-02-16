pragma solidity =0.5.16;

import './interfaces/IDXswapFactory.sol';
import './interfaces/IDXswapPair.sol';
import './interfaces/IWETH.sol';
import './libraries/TransferHelper.sol';
import './libraries/SafeMath.sol';


contract DXswapFeeReceiver {
    using SafeMath for uint;

    uint256 ONE_HUNDRED_PERCENT = 10^10;

    address public owner;
    IDXswapFactory public factory;
    IWETH public WETH;
    address public honeyToken;
    address public hsfToken;
    address public honeyReceiver;
    address public hsfReceiver;
    uint256 public splitHoneyProportion;

    constructor(
        address _owner, address _factory, IWETH _WETH, address _honeyToken, address _hsfToken, address _honeyReceiver,
        address _hsfReceiver, uint256 _splitHoneyProportion
    ) public {
        owner = _owner;
        factory = IDXswapFactory(_factory);
        WETH = _WETH;
        honeyToken = _honeyToken;
        hsfToken = _hsfToken;
        honeyReceiver = _honeyReceiver;
        hsfReceiver = _hsfReceiver;
        splitHoneyProportion = _splitHoneyProportion;
    }

    function() external payable {}

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        owner = newOwner;
    }

    function changeReceivers(address _ethReceiver, address _hsfReceiver) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        honeyReceiver = _ethReceiver;
        hsfReceiver = _hsfReceiver;
    }

    // Returns sorted token addresses, used to handle return values from pairs sorted in this order
    function _sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, 'DXswapFeeReceiver: IDENTICAL_ADDRESSES');
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'DXswapFeeReceiver: ZERO_ADDRESS');
    }

    // Helper function to know if an address is a contract, extcodesize returns the size of the code of a smart
    //  contract in a specific address
    function _isContract(address addr) internal returns (bool) {
        uint size;
        assembly { size := extcodesize(addr) }
        return size > 0;
    }

    // Calculates the CREATE2 address for a pair without making any external calls
    // Taken from DXswapLibrary, removed the factory parameter
    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = _sortTokens(tokenA, tokenB);
        pair = address(uint(keccak256(abi.encodePacked(
                hex'ff',
                factory,
                keccak256(abi.encodePacked(token0, token1)),
                hex'f23fac090dc304615f73576672d67b74204fd7c289024743f16fc2ff983711ca' // init code hash 1hive's
//                hex'd306a548755b9295ee49cc729e13ca4a45e00199bbd890fa146da43a50571776' // init code hash original
            ))));
    }

    // Done with code form DXswapRouter and DXswapLibrary, removed the deadline argument
    function _swapTokens(uint amountIn, address fromToken, address toToken)
    internal returns (uint256 amountOut)
    {
        IDXswapPair pairToUse = IDXswapPair(_pairFor(fromToken, toToken));

        (uint reserve0, uint reserve1,) = pairToUse.getReserves();
        (uint reserveIn, uint reserveOut) = fromToken < toToken ? (reserve0, reserve1) : (reserve1, reserve0);

        require(reserveIn > 0 && reserveOut > 0, 'DXswapFeeReceiver: INSUFFICIENT_LIQUIDITY');
        uint amountInWithFee = amountIn.mul(uint(10000).sub(pairToUse.swapFee()));
        uint numerator = amountInWithFee.mul(reserveOut);
        uint denominator = reserveIn.mul(10000).add(amountInWithFee);
        amountOut = numerator / denominator;

        TransferHelper.safeTransfer(
            fromToken, address(pairToUse), amountIn
        );

        (uint amount0Out, uint amount1Out) = fromToken < toToken ? (uint(0), amountOut) : (amountOut, uint(0));

        pairToUse.swap(
            amount0Out, amount1Out, address(this), new bytes(0)
        );

        //        IWETH(WETH).withdraw(amountOut);
        //        TransferHelper.safeTransferETH(ethReceiver, amountOut);
    }

    // Transfer to the owner address the token converted into ETH if possible, if not just transfer the token.
    function _swapForWeth(address token, uint amount) internal {
        require(_isContract(_pairFor(token, address(WETH))), 'DXswapFeeReceiver: WETH_PAIR_NOT_CONTRACT');
        _swapTokens(amount, token, address(WETH));
    }

    // Take what was charged as protocol fee from the DXswap pair liquidity
    function takeProtocolFee(IDXswapPair[] calldata pairs) external {
        for (uint i = 0; i < pairs.length; i++) {
            address token0 = pairs[i].token0();
            address token1 = pairs[i].token1();
            pairs[i].transfer(address(pairs[i]), pairs[i].balanceOf(address(this)));
            (uint amount0, uint amount1) = pairs[i].burn(address(this));
            if (amount0 > 0 && token0 != address(WETH))
                _swapForWeth(token0, amount0);
            if (amount1 > 0 && token1 != address(WETH))
                _swapForWeth(token1, amount1);

            uint256 wethBalance = WETH.balanceOf(address(this));
            uint256 wethToConvertToHoney = (wethBalance.mul(splitHoneyProportion)) / ONE_HUNDRED_PERCENT;
            uint256 wethToConvertToHsf = wethBalance.sub(wethToConvertToHoney);

            uint256 honeyEarned = _swapTokens(wethToConvertToHoney, address(WETH), honeyToken);
            TransferHelper.safeTransfer(honeyToken, honeyReceiver, honeyEarned);

            uint256 hsfEarned = _swapTokens(wethToConvertToHsf, address(WETH), hsfToken);
            TransferHelper.safeTransfer(hsfToken, hsfReceiver, hsfEarned);
        }
    }
}
