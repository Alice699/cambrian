# cambrian - Thru Program Makefile
# This makefile builds your Thru program using the C SDK

BASEDIR:=$(CURDIR)/build

# The official SDK installs under ~/.thru.  The SDK's GCC helper otherwise
# searches only project ancestors, which misses a user-level installation.
THRU_C_SDK_DIR?=$(HOME)/.thru/sdk/c/thru-sdk
RISCV_TOOLCHAIN_ROOT?=$(HOME)/.thru/sdk/toolchain
RISCV_SYSROOT?=$(RISCV_TOOLCHAIN_ROOT)/picolibc/thruvm

include $(THRU_C_SDK_DIR)/thru_c_program.mk
