pragma solidity =0.5.16;

import './interfaces/IDXswapFactory.sol';
import './interfaces/IDXswapPair.sol';
import './interfaces/IERC20.sol';
import './interfaces/IRewardManager.sol';
import './libraries/TransferHelper.sol';
import './libraries/SafeMath.sol';


contract DXswapFeeReceiver {
    using SafeMath for uint;

    uint256 public constant ONE_HUNDRED_PERCENT = 10**10;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public owner;
    IDXswapFactory public factory;
    IERC20 public honeyToken;
    IERC20 public hsfToken;
    address public honeyReceiver;
    IRewardManager public hsfReceiver;
    uint256 public splitHoneyProportion;

    constructor(
        address _owner, address _factory, IERC20 _honeyToken, IERC20 _hsfToken, address _honeyReceiver,
        IRewardManager _hsfReceiver, uint256 _splitHoneyProportion
    ) public {
        require(_splitHoneyProportion <= ONE_HUNDRED_PERCENT / 2, 'DXswapFeeReceiver: HONEY_PROPORTION_TOO_HIGH');
        owner = _owner;
        factory = IDXswapFactory(_factory);
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

    function changeReceivers(address _honeyReceiver, IRewardManager _hsfReceiver) external {
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
                hex'7ac2e70fa31638e66d91c5343fa7a0f9c140a0b595ffdc5fdd856c5cb0ec6b24' // matic init code hash
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

    function _swapForHoney(address token, uint amount) internal {
        require(_isContract(_pairFor(token, address(honeyToken))), 'DXswapFeeReceiver: NO_HONEY_PAIR');
        _swapTokens(amount, token, address(honeyToken));
    }

    // Take what was charged as protocol fee from the DXswap pair liquidity
    function takeProtocolFee(IDXswapPair[] calldata pairs) external {
        for (uint i = 0; i < pairs.length; i++) {
            address token0 = pairs[i].token0();
            address token1 = pairs[i].token1();
            pairs[i].transfer(address(pairs[i]), pairs[i].balanceOf(address(this)));
            (uint amount0, uint amount1) = pairs[i].burn(address(this));

            if (amount0 > 0 && token0 != address(honeyToken))
                _swapForHoney(token0, amount0);
            if (amount1 > 0 && token1 != address(honeyToken))
                _swapForHoney(token1, amount1);

            uint256 honeyBalance = honeyToken.balanceOf(address(this));
            uint256 honeyEarned = (honeyBalance.mul(splitHoneyProportion)) / ONE_HUNDRED_PERCENT;
            TransferHelper.safeTransfer(address(honeyToken), honeyReceiver, honeyEarned);

            uint256 honeyToConvertToHsf = honeyBalance.sub(honeyEarned);
            uint256 hsfEarned = _swapTokens(honeyToConvertToHsf, address(honeyToken), address(hsfToken));
            uint256 halfHsfEarned = hsfEarned / 2;
            TransferHelper.safeTransfer(address(hsfToken), BURN_ADDRESS, halfHsfEarned);
            TransferHelper.safeTransfer(address(hsfToken), address(hsfReceiver), halfHsfEarned);
            hsfReceiver.rebalance();
        }
    }
}
