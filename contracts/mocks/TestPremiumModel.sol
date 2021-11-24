pragma solidity 0.8.7;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract TestPremiumModel {
    using SafeMath for uint256;
    using Address for address;

    event CommitNewAdmin(uint256 deadline, address future_admin);
    event NewAdmin(address admin);


    constructor() {
    }

    function getPremium(
        uint256 _amount,
        uint256 _term,
        uint256 _totalLiquidity,
        uint256 _lockedAmount
    ) external view returns (uint256) {
        return 100;
    }
}
