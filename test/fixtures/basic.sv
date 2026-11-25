// A made-up toaster timer: a counter and a small state machine.
`timescale 1ns/1ps
`include "toaster_defs.vh"
`define TICKS 8'd200

/* Counts clock ticks while the toaster is on.
   (* keep *) marks a signal the tools must not remove. */
module toaster_timer #(
  parameter int WIDTH = 8,
  parameter real DELAY_NS = 2.5e1
) (
  input  logic             clk,
  input  logic             rst_n,
  input  logic             start,
  output logic [WIDTH-1:0] ticks,
  output logic             heat
);

  typedef enum logic [1:0] {IDLE, TOAST, POP} state_t;
  state_t state, next_state;

  (* keep *) logic [WIDTH-1:0] counter;
  localparam logic [3:0] MASK = 4'b10_1x;
  wire done = (counter == `TICKS);

  // The state register.
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) state <= IDLE;
    else        state <= next_state;
  end

  // Pick the next state from the current one.
  always @(*) begin
    next_state = state;
    case (state)
      IDLE:  if (start) next_state = TOAST;
      TOAST: if (done)  next_state = POP;
      POP:   next_state = IDLE;
      default: next_state = IDLE;
    endcase
  end

  always_ff @(posedge clk) begin
    if (state == TOAST) counter <= counter + 1'b1;
    else                counter <= '0;
  end

  assign ticks = counter;
  assign heat  = (state == TOAST);

  initial begin
    #10ns;
    $display("Toaster ready, width = %0d, bits = %0d", WIDTH, $clog2(WIDTH));
  end

  wire [3:0] \bus+index = 4'hF;
  int small = int'(WIDTH);
  int pair[2] = '{1_000, 16'sd5};

endmodule
