pragma solidity =0.5.16;

import './interfaces/IDXswapFactory.sol';
import './interfaces/IDXswapPair.sol';
import './interfaces/IWrappedNativeCurrency.sol';
import './libraries/TransferHelper.sol';
import './libraries/SafeMath.sol';


contract DXswapFeeReceiver {
    using SafeMath for uint;

    uint256 public constant ONE_HUNDRED_PERCENT = 10**10;
    address public owner;
    IDXswapFactory public factory;
    IWrappedNativeCurrency public wrappedNativeCurrency;
    address public honeyToken;
    address public hsfToken;
    address public honeyReceiver;
    address public hsfReceiver;
    uint256 public splitHoneyProportion;

    constructor(
        address _owner, address _factory, IWrappedNativeCurrency _wrappedNativeCurrency, address _honeyToken, address _hsfToken, address _honeyReceiver,
        address _hsfReceiver, uint256 _splitHoneyProportion
    ) public {
        require(_splitHoneyProportion <= ONE_HUNDRED_PERCENT / 2, 'DXswapFeeReceiver: HONEY_PROPORTION_TOO_HIGH');
        owner = _owner;
        factory = IDXswapFactory(_factory);
        wrappedNativeCurrency = _wrappedNativeCurrency;
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

    function changeReceivers(address _honeyReceiver, address _hsfReceiver) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        honeyReceiver = _honeyReceiver;
        hsfReceiver = _hsfReceiver;
    }

    function changeSplitHoneyProportion(uint256 _splitHoneyProportion) external {
        require(msg.sender == owner, 'DXswapFeeReceiver: FORBIDDEN');
        require(_splitHoneyProportion <= ONE_HUNDRED_PERCENT / 2, 'DXswapFeeReceiver: HONEY_PROPORTION_TOO_HIGH');
        splitHoneyProportion = _splitHoneyProportion;
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

    // Done with code from DXswapRouter and DXswapLibrary, removed the deadline argument
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
    }

    function _swapForWrappedNativeCurrency(address token, uint amount) internal {
        require(_isContract(_pairFor(token, address(wrappedNativeCurrency))), 'DXswapFeeReceiver: WRAPPED_NATIVE_CURRENCY_PAIR_NOT_CONTRACT');
        _swapTokens(amount, token, address(wrappedNativeCurrency));
    }

    // Take what was charged as protocol fee from the DXswap pair liquidity
    function takeProtocolFee(IDXswapPair[] calldata pairs) external {
        for (uint i = 0; i < pairs.length; i++) {
            address token0 = pairs[i].token0();
            address token1 = pairs[i].token1();
            pairs[i].transfer(address(pairs[i]), pairs[i].balanceOf(address(this)));
            (uint amount0, uint amount1) = pairs[i].burn(address(this));

            if (amount0 > 0 && token0 != address(wrappedNativeCurrency))
                _swapForWrappedNativeCurrency(token0, amount0);
            if (amount1 > 0 && token1 != address(wrappedNativeCurrency))
                _swapForWrappedNativeCurrency(token1, amount1);

            uint256 wNativeBalance = wrappedNativeCurrency.balanceOf(address(this));
            uint256 wNativeToConvertToHoney = (wNativeBalance.mul(splitHoneyProportion)) / ONE_HUNDRED_PERCENT;
            uint256 wNativeToConvertToHsf = wNativeBalance.sub(wNativeToConvertToHoney);

            uint256 honeyEarned = _swapTokens(wNativeToConvertToHoney, address(wrappedNativeCurrency), honeyToken);
            TransferHelper.safeTransfer(honeyToken, honeyReceiver, honeyEarned);

            uint256 hsfEarned = _swapTokens(wNativeToConvertToHsf, address(wrappedNativeCurrency), hsfToken);
            uint256 halfHsfEarned = hsfEarned / 2;
            TransferHelper.safeTransfer(hsfToken, hsfReceiver, halfHsfEarned);
            TransferHelper.safeTransfer(hsfToken, address(0), halfHsfEarned);
        }
    }
}
