const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

const {
  verifyBalances,
  verifyAllowance,
  verifyPoolsStatus,
  verifyPoolsStatusOf,
  verifyValueOfUnderlying,
  verifyIndexStatus,
  verifyVaultStatus,
  verifyVaultStatusOf,
  verifyRate,
  insure
} = require('../test-utils')


const{ 
  ZERO_ADDRESS,
  long,
  wrong,
  short,
  YEAR,
  WEEK,
  DAY
} = require('../constant-utils');


async function snapshot () {
  return network.provider.send('evm_snapshot', [])
}

async function restore (snapshotId) {
  return network.provider.send('evm_revert', [snapshotId])
}

async function moveForwardPeriods (days) {
  await ethers.provider.send("evm_increaseTime", [DAY.mul(days).toNumber()]);
  await ethers.provider.send("evm_mine");

  return true
}

async function now () {
  return BigNumber.from((await ethers.provider.getBlock("latest")).timestamp);
}

describe("Pool", function () {
  const approveDeposit = async ({token, target, depositer, amount}) => {
    await token.connect(depositer).approve(vault.address, amount);
    await target.connect(depositer).deposit(amount);
  }

  const approveDepositAndWithdrawRequest = async ({token, target, depositer, amount}) => {
    await token.connect(depositer).approve(vault.address, amount);
    await target.connect(depositer).deposit(amount);
    await target.connect(depositer).requestWithdraw(amount);
  }

  const applyCover = async ({pool, pending, payoutNumerator, payoutDenominator, incidentTimestamp}) => {

    const tree = await new MerkleTree(short, keccak256, {
      hashLeaves: true,
      sortPairs: true,
    });

    const root = await tree.getHexRoot();
    const leaf = keccak256(short[0]);
    const proof = await tree.getHexProof(leaf);

    await pool.applyCover(
      pending,
      payoutNumerator,
      payoutDenominator,
      incidentTimestamp,
      root,
      short,
      "metadata"
    );

    return proof
  }

  before(async () => {
    //import
    [creator, alice, bob, chad, tom] = await ethers.getSigners();
    const Ownership = await ethers.getContractFactory("Ownership");
    const DAI = await ethers.getContractFactory("TestERC20Mock");
    const PoolTemplate = await ethers.getContractFactory("PoolTemplate");
    const Factory = await ethers.getContractFactory("Factory");
    const Vault = await ethers.getContractFactory("Vault");
    const Registry = await ethers.getContractFactory("Registry");
    const FeeModel = await ethers.getContractFactory("FeeModel");
    const PremiumModel = await ethers.getContractFactory("TestPremiumModel");
    const Parameters = await ethers.getContractFactory("Parameters");
    const Contorller = await ethers.getContractFactory("ControllerMock");

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

    await fee.setFee("10000");
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

  beforeEach(async () => {
    snapshotId = await snapshot()
  });

  afterEach(async () => {
    await restore(snapshotId)
  })

  describe("Condition", function () {
    it("Should contracts be deployed", async () => {
      expect(dai.address).to.exist;
      expect(factory.address).to.exist;
      expect(poolTemplate.address).to.exist;
      expect(parameters.address).to.exist;
      expect(vault.address).to.exist;
      expect(market.address).to.exist;
    });
  });

  describe("iToken", function () {
    beforeEach(async () => {
      await dai.connect(alice).approve(vault.address, 10000);
      await dai.connect(bob).approve(vault.address, 10000);
      await dai.connect(chad).approve(vault.address, 10000);

      await market.connect(alice).deposit("10000");
      await market.connect(bob).deposit("10000");
      await market.connect(chad).deposit("10000");
    });

    describe("allowance", function () {
      it("returns no allowance", async function () {
        expect(await market.allowance(alice.address, tom.address)).to.equal(
          "0"
        );
      });
      it("approve/ increases/ decrease change allowance", async function () {
        await market.connect(alice).approve(tom.address, 5000);
        expect(await market.allowance(alice.address, tom.address)).to.equal(
          "5000"
        );
        await market.connect(alice).decreaseAllowance(tom.address, "5000");
        expect(await market.allowance(alice.address, tom.address)).to.equal(
          "0"
        );
        await market.connect(alice).increaseAllowance(tom.address, "10000");
        expect(await market.allowance(alice.address, tom.address)).to.equal(
          "10000"
        );
      });
    });

    describe("total supply", function () {
      it("returns the total amount of tokens", async function () {
        expect(await market.totalSupply()).to.equal("30000");
      });
    });

    describe("balanceOf", function () {
      context("when the requested account has no tokens", function () {
        it("returns zero", async function () {
          expect(await market.balanceOf(tom.address)).to.equal("0");
        });
      });

      context("when the requested account has some tokens", function () {
        it("returns the total amount of tokens", async function () {
          expect(await market.balanceOf(alice.address)).to.equal("10000");
        });
      });
    });

    describe("transfer", function () {
      context("when the recipient is not the zero address", function () {
        context("when the sender does not have enough balance", function () {
          it("reverts", async function () {
            await expect(
              market.connect(alice).transfer(tom.address, "10001")
            ).to.reverted;
          });
        });

        context("when the sender has enough balance", function () {
          it("transfers the requested amount", async function () {
            await market.connect(alice).transfer(tom.address, "10000");
            expect(await market.balanceOf(alice.address)).to.equal("0");
            expect(await market.balanceOf(tom.address)).to.equal("10000");
          });
        });
      });

      context("when the recipient is the zero address", function () {
        it("reverts", async function () {
          await expect(
            market.connect(tom).transfer(ZERO_ADDRESS, 10000)
          ).to.revertedWith("ERC20: transfer to the zero address");
        });
      });
    });
  });

  describe("Parameters", function () {
    describe("get fee", function () {
      context("100000", function () {
        it("returns fee", async function () {
          expect(await parameters.getFee("100000", ZERO_ADDRESS)).to.equal(
            "10000"
          );
        });
      });
    });
    describe("get lockup", function () {
      it("returns lockup period", async function () {
        expect(await parameters.getLockup(ZERO_ADDRESS)).to.equal("604800");
      });
    });
    describe("get grace", function () {
      it("returns garace period", async function () {
        expect(await parameters.getGrace(ZERO_ADDRESS)).to.equal("259200");
      });
    });
  });

  describe("Liquidity providing life cycles", function () {
    it("allows deposit and withdraw", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await verifyPoolsStatus({
        pools: [
          {
            pool: market,
            totalLiquidity: 10000,
            availableBalance: 10000
          }
        ]
      })

      await verifyPoolsStatusOf({
        pools: [
          {
            pool: market,
            allocatedCreditOf: alice.address,
            allocatedCredit: 0,
          }
        ]
      })

      await verifyVaultStatus({
        vault: vault,
        valueAll: 10000,
        totalAttributions: 10000,
      })

      await verifyVaultStatusOf({
        vault: vault,
        target: market.address,
        attributions: 10000,
        underlyingValue: 10000
      })

      expect(await market.rate()).to.equal(BigNumber.from(10).pow(18));

      await moveForwardPeriods(8)
      await market.connect(alice).withdraw("10000");

      expect(await market.totalSupply()).to.equal("0");
      expect(await market.totalLiquidity()).to.equal("0");
    });

    it("DISABLES withdraw when not requested", async function () {
      await approveDeposit({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await moveForwardPeriods(8)
      await expect(market.connect(alice).withdraw("10000")).to.revertedWith(
        "ERROR: WITHDRAWAL_NO_ACTIVE_REQUEST"
      );
    });

    it("DISABLES withdraw more than requested", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      expect(await market.totalSupply()).to.equal("10000");
      expect(await market.totalLiquidity()).to.equal("10000");

      await moveForwardPeriods(8)
      await expect(market.connect(alice).withdraw("100000")).to.revertedWith(
        "ERROR: WITHDRAWAL_EXCEEDED_REQUEST"
      );
      await market.connect(alice).withdraw("5000");

      expect(await market.totalSupply()).to.equal("5000");
      expect(await market.totalLiquidity()).to.equal("5000");
    });

    it("DISABLES withdraw if withdrawable span ended", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await moveForwardPeriods(40)
      await expect(market.connect(alice).withdraw("10000")).to.revertedWith(
        "ERROR: WITHDRAWAL_NO_ACTIVE_REQUEST"
      );
    });

    it("DISABLES withdraw request more than balance", async function () {
      await approveDeposit({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })
      
      await expect(
        market.connect(alice).requestWithdraw("100000")
      ).to.revertedWith("ERROR: REQUEST_EXCEED_BALANCE");
    });

    it("DISABLES withdraw zero balance", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await moveForwardPeriods(8)
      await expect(market.connect(alice).withdraw("0")).to.revertedWith(
        "ERROR: WITHDRAWAL_ZERO"
      );
    });

    it("DISABLES withdraw when liquidity is locked for insurance", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await dai.connect(bob).approve(vault.address, 10000);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 10,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      await moveForwardPeriods(8)

      await expect(market.connect(alice).withdraw("10000")).to.revertedWith(
        "ERROR: WITHDRAW_INSUFFICIENT_LIQUIDITY"
      );
    });

    it("allows unlock liquidity only after an insurance period over", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await moveForwardPeriods(8)

      await dai.connect(bob).approve(vault.address, 10000);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      await expect(market.unlock("0")).to.revertedWith(
        "ERROR: UNLOCK_BAD_COINDITIONS"
      );

      await moveForwardPeriods(12)
      await market.unlock("0");

      await verifyVaultStatusOf({
        vault: vault,
        target: market.address,
        attributions: 10090,
        underlyingValue: 10090
      })
      await verifyVaultStatusOf({
        vault: vault,
        target: creator.address,
        attributions: 10,
        underlyingValue: 10
      })

      await verifyVaultStatus({
        vault: vault,
        valueAll: 10100,
        totalAttributions: 10100,
      })

      await verifyPoolsStatus({
        pools: [
          {
            pool: market,
            totalLiquidity: 10090,
            availableBalance: 10090
          }
        ]
      })

      await verifyPoolsStatusOf({
        pools: [
          {
            pool: market,
            allocatedCreditOf: alice.address,
            allocatedCredit: 0,
          }
        ]
      })

      await verifyBalances({
        token: dai,
        userBalances: {
          [alice.address]: 90000,
        }
      })
      

      await market.connect(alice).withdraw("10000");

      await verifyPoolsStatus({
        pools: [
          {
            pool: market,
            totalLiquidity: 0,
            availableBalance: 0
          }
        ]
      })

      await verifyPoolsStatusOf({
        pools: [
          {
            pool: market,
            allocatedCreditOf: alice.address,
            allocatedCredit: 0,
          }
        ]
      })

      await verifyBalances({
        token: dai,
        userBalances: {
          [alice.address]: 100090,
        }
      })

      await verifyVaultStatus({
        vault: vault,
        valueAll: 10,
        totalAttributions: 10,
      })
    });

    it("also decrease withdrawal request when transefered", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await moveForwardPeriods(8)

      await market.connect(alice).transfer(tom.address, 5000);
      await expect(market.connect(alice).withdraw("5001")).to.revertedWith(
        "ERROR: WITHDRAWAL_EXCEEDED_REQUEST"
      );
      await market.connect(alice).withdraw("5000");
    });

    it("accrues premium after deposit", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      expect(await market.rate()).to.equal(BigNumber.from(10).pow(18));

      //apply protection by Bob
      await dai.connect(bob).approve(vault.address, 20000);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 365,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      //Alice should have accrued premium paid by Bob
      await verifyBalances({
        token: dai,
        userBalances: {
          [bob.address]: 99900,
        }
      })

      await verifyValueOfUnderlying({
        template: market,
        valueOfUnderlyingOf: alice.address,
        valueOfUnderlying: 10090
      })

      await verifyPoolsStatus({
        pools: [
          {
            pool: market,
            totalLiquidity: 10090,
            availableBalance: 91
          }
        ]
      })

      await verifyRate({
        template: market,
        rate: "1009000000000000000"
      })

      await verifyVaultStatusOf({
        vault: vault,
        target: creator.address,
        attributions: 10,
        underlyingValue: 10
      })

      await verifyVaultStatus({
        vault: vault,
        valueAll: 10100,
        totalAttributions: 10100,
      })


      //additional deposit by Chad, which does not grant any right to withdraw premium before deposit
      await approveDeposit({
        token: dai,
        target: market,
        depositer: chad,
        amount: 10000
      })

      await verifyBalances({
        token: market,
        userBalances: {
          [chad.address]: 9910,
        }
      })

      await verifyValueOfUnderlying({
        template: market,
        valueOfUnderlyingOf: chad.address,
        valueOfUnderlying: 9999
      })


      await verifyPoolsStatus({
        pools: [
          {
            pool: market,
            totalLiquidity: 20090,
            availableBalance: 10091
          }
        ]
      })

      //the premium paid second time should be allocated to both Alice and Chad
      //but the premium paid first time should be directly go to Alice
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 365,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      await verifyBalances({
        token: dai,
        userBalances: {
          [bob.address]: 99800,
        }
      })

      await verifyValueOfUnderlying({
        template: market,
        valueOfUnderlyingOf: alice.address,
        valueOfUnderlying: 10135
      })

      await verifyValueOfUnderlying({
        template: market,
        valueOfUnderlyingOf: chad.address,
        valueOfUnderlying: 10044
      })

      await verifyPoolsStatus({
        pools: [
          {
            pool: market,
            totalLiquidity: 20180,
            availableBalance: 182
          }
        ]
      })

      //withdrawal also harvest accrued premium
      await moveForwardPeriods(369)

      await market.connect(alice).requestWithdraw("10000");
      await market.unlockBatch(["0", "1"]);

      await moveForwardPeriods(8)

      await market.connect(alice).withdraw("10000");
      //Harvested premium is reflected on their account balance

      await verifyBalances({
        token: dai,
        userBalances: {
          [alice.address]: 100134,
          [chad.address]: 90000,
        }
      })
    });

    it("DISABLE deposit when paused(withdrawal is possible)", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      expect(await market.totalSupply()).to.equal("10000");
      await verifyPoolsStatus({
        pools: [
          {
            pool: market,
            totalLiquidity: 10000,
            availableBalance: 10000
          }
        ]
      })

      await market.setPaused(true);

      await dai.connect(alice).approve(vault.address, 20000);
      await expect(market.connect(alice).deposit("10000")).to.revertedWith(
        "ERROR: DEPOSIT_DISABLED"
      );

      await moveForwardPeriods(8)

      await verifyRate({
        template: market,
        rate: "1000000000000000000"
      })

      await market.connect(alice).withdraw("10000");

      await verifyBalances({
        token: dai,
        userBalances: {
          [alice.address]: 100000
        }
      })
    });

    it("DISABLE deposit and withdrawal when payingout", async function () {
      //Can deposit and withdraw in normal time
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await moveForwardPeriods(8)
      await market.connect(alice).withdraw("10000");
      expect(await dai.balanceOf(alice.address)).to.equal("100000");
      //Cannot deposit and withdraw when payingout

      await approveDeposit({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })
      await market.connect(alice).requestWithdraw("10000");

      let incident = (await now()).sub(DAY.mul(2));  

      await applyCover({
        pool: market,
        pending: 604800,
        payoutNumerator: 10000,
        payoutDenominator: 10000,
        incidentTimestamp: incident
      })

      await expect(market.connect(alice).deposit("10000")).to.revertedWith(
        "ERROR: DEPOSIT_DISABLED"
      );
      await expect(market.connect(alice).withdraw("10000")).to.revertedWith(
        "ERROR: WITHDRAWAL_PENDING"
      );

      await moveForwardPeriods(11)
      await market.resume();

      await verifyRate({
        template: market,
        rate: "1000000000000000000"
      })

      await market.connect(alice).withdraw("10000");

      await verifyBalances({
        token: dai,
        userBalances: {
          [alice.address]: 100000
        }
      })
    });

    it("devaluate underlying but premium is not affected when cover claim is accepted", async function () {
      //Simulation: partial payout
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await dai.connect(bob).approve(vault.address, 10000);

      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      await verifyBalances({
        token: dai,
        userBalances: {
          [bob.address]: 99900
        }
      })

      await verifyVaultStatusOf({
        vault: vault,
        target: creator.address,
        attributions: 10,
        underlyingValue: 10
      })

      await verifyVaultStatusOf({
        vault: vault,
        target: market.address,
        attributions: 10090,
        underlyingValue: 10090
      })

      let incident = await now()
      let proof = await applyCover({
        pool: market,
        pending: 604800,
        payoutNumerator: 5000,
        payoutDenominator: 10000,
        incidentTimestamp: incident
      })

      await market.connect(bob).redeem("0", proof);
      await expect(market.unlock("0")).to.revertedWith(
        "ERROR: UNLOCK_BAD_COINDITIONS"
      );
      expect(await market.totalSupply()).to.equal("10000");
      expect(await market.totalLiquidity()).to.closeTo("5091", "1");
      expect(await market.valueOfUnderlying(alice.address)).to.closeTo(
        "5091",
        "1"
      );
      await moveForwardPeriods(11)
      await market.resume();

      await market.connect(alice).withdraw("10000");
      expect(await dai.balanceOf(alice.address)).to.closeTo("95091", "3"); //verify
      expect(await dai.balanceOf(bob.address)).to.closeTo("104899", "3"); //verify

      //Simulation: full payout
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })
      expect(await market.totalSupply()).to.equal("10000");
      expect(await market.totalLiquidity()).to.equal("10000");

      currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //endTime = await currentTimestamp.add(86400 * 8);

      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      incident = await now()
      proof = await applyCover({
        pool: market,
        pending: 604800,
        payoutNumerator: 10000,
        payoutDenominator: 10000,
        incidentTimestamp: incident
      })

      await market.connect(bob).redeem("1", proof);

      expect(await market.totalSupply()).to.equal("10000");
      expect(await market.totalLiquidity()).to.equal("91");
      expect(await market.valueOfUnderlying(alice.address)).to.equal("91");
      await moveForwardPeriods(11)
      await market.resume();
      await market.connect(alice).withdraw("10000");
      expect(await dai.balanceOf(alice.address)).to.closeTo("85182", "3"); //verify
      expect(await dai.balanceOf(bob.address)).to.closeTo("114798", "3"); //verify
    });
  });

  describe("Getting insured", function () {
    it("allows protection", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await dai.connect(bob).approve(vault.address, 10000);
      let currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //let endTime = await currentTimestamp.add(86400 * 8);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      let incident = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      const tree = await new MerkleTree(long, keccak256, {
        hashLeaves: true,
        sortPairs: true,
      });
      const root = await tree.getHexRoot();
      const leaf = keccak256(long[0]);
      const proof = await tree.getHexProof(leaf);
      let tx = await market.applyCover(
        "604800",
        5000,
        10000,
        incident,
        root,
        long,
        "metadata"
      );
      let receipt = await tx.wait();
      console.log(
        receipt.events?.filter((x) => {
          return x.event == "CoverApplied";
        })
      );

      await market.connect(bob).redeem("0", proof);
      await moveForwardPeriods(12)
      await market.resume();
      await expect(market.unlock("0")).to.revertedWith(
        "ERROR: UNLOCK_BAD_COINDITIONS"
      );
      await market.connect(alice).withdraw("10000");
      expect(await dai.balanceOf(alice.address)).to.closeTo("95091", "1");
      expect(await dai.balanceOf(bob.address)).to.closeTo("104899", "1");
    });

    it("allows insurance transfer", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await dai.connect(bob).approve(vault.address, 10000);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      await market.connect(bob).transferInsurance("0", tom.address);
      let incident = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      const tree = await new MerkleTree(long, keccak256, {
        hashLeaves: true,
        sortPairs: true,
      });
      const root = await tree.getHexRoot();
      const leaf = keccak256(long[0]);
      const proof = await tree.getHexProof(leaf);
      await market.applyCover(
        "604800",
        5000,
        10000,
        incident,
        root,
        long,
        "metadata"
      );

      await market.connect(tom).redeem("0", proof);
      await moveForwardPeriods(11)
      await market.resume();
      await market.connect(alice).withdraw("10000");
      expect(await dai.balanceOf(alice.address)).to.equal("95091");
      expect(await dai.balanceOf(tom.address)).to.equal("4999");
    });
    it("DISALLOWS redemption when insurance is not a target", async function () {
      await dai.connect(bob).approve(vault.address, 10000);
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })


      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      let incident = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      const tree = await new MerkleTree(wrong, keccak256, {
        hashLeaves: true,
        sortPairs: true,
      });
      const root = await tree.getHexRoot();
      const leaf = keccak256(wrong[0]);
      const proof = await tree.getHexProof(leaf);
      await market.applyCover(
        "604800",
        5000,
        10000,
        incident,
        root,
        long,
        "metadata"
      );
      await moveForwardPeriods(12)

      await market.resume();
      await expect(market.connect(bob).redeem("0", proof)).to.revertedWith(
        "ERROR: NO_APPLICABLE_INCIDENT"
      );
      await market.unlock("0");
      await market.connect(alice).withdraw("10000");
      expect(await dai.balanceOf(alice.address)).to.equal("100090");
    });
    it("DISALLOWS getting insured when there is not enough liquidity", async function () {
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 100
      })

      await expect(
        market
          .connect(bob)
          .insure(
            "9999",
            "10000",
            86400 * 8,
            "0x4e69636b00000000000000000000000000000000000000000000000000000000"
          )
      ).to.revertedWith("ERROR: INSURE_EXCEEDED_AVAILABLE_BALANCE");


      await moveForwardPeriods(8)
      await market.connect(alice).withdraw("100");
      expect(await dai.balanceOf(alice.address)).to.equal("100000");
    });

    it("DISALLOWS redemption when redemption period is over", async function () {
      await dai.connect(bob).approve(vault.address, 10000);
      await approveDepositAndWithdrawRequest({
        token: dai,
        target: market,
        depositer: alice,
        amount: 10000
      })

      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      let incident = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      const tree = await new MerkleTree(long, keccak256, {
        hashLeaves: true,
        sortPairs: true,
      });
      const root = await tree.getHexRoot();
      const leaf = keccak256(long[0]);
      const proof = await tree.getHexProof(leaf);
      await market.applyCover(
        "604800",
        5000,
        10000,
        incident,
        root,
        long,
        "metadata"
      );
      await moveForwardPeriods(12)

      await market.resume();

      await expect(market.connect(bob).redeem("0", proof)).to.revertedWith(
        "ERROR: NO_APPLICABLE_INCIDENT"
      );
      await market.unlock("0");
      await market.connect(alice).withdraw("10000");
      expect(await dai.balanceOf(alice.address)).to.equal("100090");
    });

    it("DISALLOWS getting insured when paused, reporting, or payingout", async function () {
      //Can get insured in normal time
      await approveDeposit({
        token: dai,
        target: market,
        depositer: alice,
        amount: 40000
      })
      await market.connect(alice).requestWithdraw("10000");

      await dai.connect(bob).approve(vault.address, 20000);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      //Cannot get insured when payingout
      let incident = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      const tree = await new MerkleTree(long, keccak256, {
        hashLeaves: true,
        sortPairs: true,
      });
      const root = await tree.getHexRoot();
      const leaf = keccak256(long[0]);
      const proof = await tree.getHexProof(leaf);
      await market.applyCover(
        "604800",
        10000,
        10000,
        incident,
        root,
        long,
        "metadata"
      );
      currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //endTime = await currentTimestamp.add(86400 * 5);

      await expect(
        market
          .connect(bob)
          .insure(
            "9999",
            "10000",
            86400 * 5,
            "0x4e69636b00000000000000000000000000000000000000000000000000000000"
          )
      ).to.revertedWith("ERROR: INSURE_SPAN_BELOW_MIN");

      await moveForwardPeriods(11)

      await market.resume();
      currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //endTime = await currentTimestamp.add(86400 * 8);

      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      //Cannot get insured when paused
      await market.setPaused(true);
      currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //endTime = await currentTimestamp.add(86400 * 8);
      await expect(
        market
          .connect(bob)
          .insure(
            "9999",
            "10000",
            86400 * 8,
            "0x4e69636b00000000000000000000000000000000000000000000000000000000"
          )
      ).to.revertedWith("ERROR: INSURE_MARKET_PAUSED");
      await market.setPaused(false);
      currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //endTime = await currentTimestamp.add(86400 * 8);

      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
    });

    it("DISALLOWS more than 365 days insurance", async function () {
      //Can get insured in normal time
      await dai.connect(bob).approve(vault.address, 20000);
      await approveDeposit({
        token: dai,
        target: market,
        depositer: alice,
        amount: 40000
      })
      await market.connect(alice).requestWithdraw("10000");

      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 365,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      //Cannot get insured for more than 365 days
      //endTime = await currentTimestamp.add(86400 * 400);
      await expect(
        market
          .connect(bob)
          .insure(
            "9999",
            "10000",
            86400 * 400,
            "0x4e69636b00000000000000000000000000000000000000000000000000000000"
          )
      ).to.revertedWith("ERROR: INSURE_EXCEEDED_MAX_SPAN");
    });

    it("DISALLOWS insurance transfer if its expired or non existent", async function () {
      await dai.connect(bob).approve(vault.address, 10000);

      await approveDeposit({
        token: dai,
        target: market,
        depositer: alice,
        amount: 40000
      })
      await market.connect(alice).requestWithdraw("10000");

      //when expired
      let currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //let endTime = await currentTimestamp.add(86400 * 8);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      await moveForwardPeriods(9)
      await expect(
        market.connect(bob).transferInsurance("0", tom.address)
      ).to.revertedWith("ERROR: INSURANCE_TRANSFER_BAD_CONDITIONS");

      //when already redeemed
      currentTimestamp = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      //endTime = await currentTimestamp.add(86400 * 8);
      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 8,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      let incident = BigNumber.from(
        (await ethers.provider.getBlock("latest")).timestamp
      );
      const tree = await new MerkleTree(long, keccak256, {
        hashLeaves: true,
        sortPairs: true,
      });
      const root = await tree.getHexRoot();
      const leaf = keccak256(long[0]);
      const proof = await tree.getHexProof(leaf);
      await market.applyCover(
        "604800",
        5000,
        10000,
        incident,
        root,
        long,
        "metadata"
      );
      await market.connect(bob).redeem("1", proof);
      await expect(
        market.connect(bob).transferInsurance("1", tom.address)
      ).to.revertedWith("ERROR: INSURANCE_TRANSFER_BAD_CONDITIONS");
    });
  });

  describe("Utilities", function () {
    it("retunrs accurate data", async function () {
      await approveDeposit({
        token: dai,
        target: market,
        depositer: alice,
        amount: 40000
      })

      await dai.connect(bob).approve(vault.address, 10000);
      await dai.connect(chad).approve(vault.address, 10000);

      await market.connect(alice).requestWithdraw("10000");
      expect(await market.utilizationRate()).to.equal("0");

      await insure({
        pool: market,
        insurer: bob,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 365,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })

      await insure({
        pool: market,
        insurer: chad,
        amount: 9999,
        maxCost: 10000,
        span: 86400 * 365,
        target: '0x4e69636b00000000000000000000000000000000000000000000000000000000'
      })
      
      expect(await market.allInsuranceCount()).to.equal("2");
      expect(await market.getInsuranceCount(bob.address)).to.equal("1");
      expect(await market.getInsuranceCount(chad.address)).to.equal("1");
      expect(await market.utilizationRate()).to.equal("49771030");
    });
  });

  describe.skip("Admin functions", function () {
    it("allows changing metadata", async function () {
      expect(await market.metadata()).to.equal("Here is metadata.");
      const latest = `{
            subject: "これは日本語だよ　这个是中文　TEST TEXTS",
            options: [“Yes”, “No”],
            description: "The website is compliant. This will release the funds to Alice."
          }`;

      await market.changeMetadata(latest);
      expect(await market.metadata()).to.equal(latest);
    });
  });
});
