const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");

const {
  verifyBalance,
} = require('../test-utils')

const{ 
  ZERO_ADDRESS,
} = require('../constant-utils');


describe("Factory", function () {

  beforeEach(async () => {
    //import
    [creator, alice, bob, chad, tom] = await ethers.getSigners();
    const Ownership = await ethers.getContractFactory("Ownership");
    const DAI = await ethers.getContractFactory("TestERC20Mock");
    const PoolTemplate = await ethers.getContractFactory("PoolTemplate");
    const Factory = await ethers.getContractFactory("Factory");
    const Vault = await ethers.getContractFactory("Vault");
    const Registry = await ethers.getContractFactory("Registry");
    const FeeModel = await ethers.getContractFactory("FeeModel");
    const PremiumModel = await ethers.getContractFactory("PremiumModel");
    const Parameters = await ethers.getContractFactory("Parameters");
    const Contorller = await ethers.getContractFactory("Controller");

    //deploy
    ownership = await Ownership.deploy();
    dai = await DAI.deploy();
    registry = await Registry.deploy(ownership.address);
    factory = await Factory.deploy(registry.address, ownership.address);
    fee = await FeeModel.deploy(ownership.address);
    premium = await PremiumModel.deploy();
    controller = await Contorller.deploy(dai.address, ownership.address);
    vault = await Vault.deploy(
      dai.address,
      registry.address,
      controller.address,
      ownership.address
    );
    poolTemplate = await PoolTemplate.deploy();
    parameters = await Parameters.deploy(ownership.address);

    //set up
    await dai.mint(chad.address, (100000).toString());
    await dai.mint(bob.address, (100000).toString());
    await dai.mint(alice.address, (100000).toString());

    await registry.setFactory(factory.address);

    await factory.approveTemplate(poolTemplate.address, true, false, true);
    await factory.approveReference(poolTemplate.address, 0, dai.address, true);
    await factory.approveReference(poolTemplate.address, 1, dai.address, true);
    await factory.approveReference(
      poolTemplate.address,
      2,
      registry.address,
      true
    );
    await factory.approveReference(
      poolTemplate.address,
      3,
      parameters.address,
      true
    );

    await premium.setPremium("2000", "50000");
    await fee.setFee("1000");
    await parameters.setCDSPremium(ZERO_ADDRESS, "2000");
    await parameters.setDepositFee(ZERO_ADDRESS, "1000");
    await parameters.setGrace(ZERO_ADDRESS, "259200");
    await parameters.setLockup(ZERO_ADDRESS, "604800");
    await parameters.setMindate(ZERO_ADDRESS, "604800");
    await parameters.setPremiumModel(ZERO_ADDRESS, premium.address);
    await parameters.setFeeModel(ZERO_ADDRESS, fee.address);
    await parameters.setWithdrawable(ZERO_ADDRESS, "2592000");
    await parameters.setVault(dai.address, vault.address);

    await factory.createMarket(
      poolTemplate.address,
      "Here is metadata.",
      [1, 0],
      [dai.address, dai.address, registry.address, parameters.address]
    );
    const marketAddress = await factory.markets(0);
    market = await PoolTemplate.attach(marketAddress);
  });

  describe("duplicate market", function () {
    it("Should revert when it's not allowed", async () => {
      await factory.approveTemplate(poolTemplate.address, true, false, false);
      await expect(
        factory.createMarket(
          poolTemplate.address,
          "Here is metadata.",
          [1, 0],
          [dai.address, dai.address, registry.address, parameters.address]
        )
      ).to.revertedWith("DUPLICATE_MARKET");
    });
    it("Should not revert when it's not allowed", async () => {
      await factory.approveTemplate(poolTemplate.address, true, false, true);
      factory.createMarket(
        poolTemplate.address,
        "Here is metadata.",
        [1, 0],
        [dai.address, dai.address, registry.address, parameters.address]
      );
    });
  });
  describe("Condition", function () {
    it("Should contracts be deployed", async () => {
      expect(registry.address).to.exist;
    });
  });
  
  describe.skip("ownership functions", function () {
    //revert test
    it("test_commit_owner_only", async () => {
      await expect(
        registry.connect(alice).commitTransferOwnership(alice.address)
      ).to.revertedWith("Restricted: caller is not allowed to operate");
    });

    it("test_apply_owner_only", async () => {
      await expect(
        registry.connect(alice).applyTransferOwnership()
      ).to.revertedWith("Restricted: caller is not allowed to operate");
    });

    //test
    it("test_commitTransferOwnership", async () => {
      await registry.commitTransferOwnership(alice.address);

      expect(await registry.owner()).to.equal(creator.address);
      expect(await registry.future_owner()).to.equal(alice.address);
    });

    it("test_applyTransferOwnership", async () => {
      await registry.commitTransferOwnership(alice.address);
      await ethers.provider.send("evm_increaseTime", [86400 * 4]);
      await registry.applyTransferOwnership();

      expect(await registry.owner()).to.equal(alice.address);
      expect(await registry.future_owner()).to.equal(alice.address);
    });

    it("test_apply_without_commit", async () => {
      await expect(registry.applyTransferOwnership()).to.revertedWith(
        "dev: no active transfer"
      );
    });
  });
});