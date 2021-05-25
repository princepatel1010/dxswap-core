pragma solidity >=0.5.0;

import '../interfaces/IERC20.sol';
import "../interfaces/IRewardManager.sol";

contract RewardManagerMock is IRewardManager {

    function rebalance() external {}
}
