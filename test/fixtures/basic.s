@ A made-up toaster countdown in ARM-style assembly.
/* Counts the seconds down to zero,
   then stops the heater. */
#include "toaster.h"
#define SECONDS 30

        .syntax unified
        .section .rodata
msg:    .asciz  "Toast is ready!\n"
mask:   .word   0xFF, 0b1010, 42
letter: .byte   'T', 'o'

        .text
        .globl  main
        .type   main, %function
main:
        push    {r4, lr}            @ save the registers
        mov     r4, #SECONDS        // seconds left
        ldr     r0, =msg
.Lloop:
        subs    r4, r4, #1
        ldr     r1, [sp, #-4]
        cmp     r4, #0x10
        bne     .Lloop
        b       1f
1:      pop     {r4, pc}
        .size   main, .-main

        .type   stop, @function
stop:
        mov     r0, #0
        svc     #0
        bx      lr
