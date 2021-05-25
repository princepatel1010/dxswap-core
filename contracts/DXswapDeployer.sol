pragma solidity =0.5.16;

import './DXswapFactory.sol';
import './interfaces/IDXswapPair.sol';
import './interfaces/IERC20.sol';
import './interfaces/IRewardManager.sol';
import './DXswapFeeSetter.sol';
import './DXswapFeeReceiver.sol';


contract DXswapDeployer {

    address payable public protocolFeeReceiver;
    address payable public owner;
    IERC20 public honeyToken;
    IERC20 public hsfToken;
    address public honeyReceiver;
    IRewardManager public hsfReceiver;
    uint256 public splitHoneyProportion;
    uint8 public state = 0;

    struct TokenPair {
        address tokenA;
        address tokenB;
        uint32 swapFee;
    }

    TokenPair[] public initialTokenPairs;

    event FeeReceiverDeployed(address feeReceiver);
    event FeeSetterDeployed(address feeSetter);
    event PairFactoryDeployed(address factory);
    event PairDeployed(address pair);

    // Step 1: Create the deployer contract with all the needed information for deployment.
    constructor(
        address payable _owner,
        address[] memory tokensA,
        address[] memory tokensB,
        uint32[] memory swapFees,
        IERC20 _honeyToken,
        IERC20 _hsfToken,
        address _honeyReceiver,
        IRewardManager _hsfReceiver,
        uint256 _splitHoneyProportion
    ) public {
        owner = _owner;
        honeyToken = _honeyToken;
        hsfToken = _hsfToken;
        honeyReceiver = _honeyReceiver;
        hsfReceiver = _hsfReceiver;
        splitHoneyProportion = _splitHoneyProportion;
        for(uint8 i = 0; i < tokensA.length; i ++) {
            initialTokenPairs.push(
                TokenPair(
                    tokensA[i],
                    tokensB[i],
                    swapFees[i]
                )
            );
        }
    }

    // Step 2: Transfer ETH from the to allow the deploy function to be called, creates an incentive to call.
    function() external payable {
        require(state == 0, 'DXswapDeployer: WRONG_DEPLOYER_STATE');
        require(msg.sender == owner, 'DXswapDeployer: CALLER_NOT_FEE_TO_SETTER');
        state = 1;
    }

    // Step 3: Deploy DXswapFactory and all initial pairs
    function deploy() public {
        require(state == 1, 'DXswapDeployer: WRONG_DEPLOYER_STATE');
        DXswapFactory dxSwapFactory = new DXswapFactory(address(this), address(honeyToken));
        emit PairFactoryDeployed(address(dxSwapFactory));
        for(uint8 i = 0; i < initialTokenPairs.length; i ++) {
            address newPair = dxSwapFactory.createPair(initialTokenPairs[i].tokenA, initialTokenPairs[i].tokenB);
            dxSwapFactory.setSwapFee(newPair, initialTokenPairs[i].swapFee);
            emit PairDeployed(address(newPair));
        }
        DXswapFeeReceiver dxSwapFeeReceiver = new DXswapFeeReceiver(
            owner, address(dxSwapFactory), honeyToken, hsfToken, honeyReceiver, hsfReceiver, splitHoneyProportion
        );
        emit FeeReceiverDeployed(address(dxSwapFeeReceiver));
        dxSwapFactory.setFeeTo(address(dxSwapFeeReceiver));

        DXswapFeeSetter dxSwapFeeSetter = new DXswapFeeSetter(owner, address(dxSwapFactory));
        emit FeeSetterDeployed(address(dxSwapFeeSetter));
        dxSwapFactory.setFeeToSetter(address(dxSwapFeeSetter));
        state = 2;
        msg.sender.transfer(address(this).balance);
    }
}
