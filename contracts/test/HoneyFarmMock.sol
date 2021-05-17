pragma solidity >=0.5.0;

import '../interfaces/IHoneyFarm.sol';
import '../interfaces/IERC20.sol';

contract HoneyFarmMock is IHoneyFarm {

    IERC20 public rewardToken;

    constructor(IERC20 _rewardToken) public {
        rewardToken = _rewardToken;
    }

    function depositAdditionalRewards(uint256 _depositAmount) external {
        rewardToken.transferFrom(msg.sender, address(this), _depositAmount);
    }
}
