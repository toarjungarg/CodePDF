-- A made-up toaster timer: a counter and a small state machine.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

/* Counts clock ticks while the toaster is on.
   The heater stays on until the count reaches the limit. */
entity toaster_timer is
  generic (
    WIDTH    : integer := 8;
    DELAY_NS : real    := 2.5e1
  );
  port (
    clk   : in  std_logic;
    rst_n : in  std_logic;
    start : in  std_logic;
    ticks : out std_logic_vector(WIDTH - 1 downto 0);
    heat  : out std_logic
  );
end entity toaster_timer;

architecture rtl of toaster_timer is
  type state_t is (IDLE, TOAST, POP);
  signal state, next_state : state_t := IDLE;
  signal count : unsigned(WIDTH - 1 downto 0) := (others => '0');
  constant LIMIT  : unsigned(7 downto 0) := x"C8";
  constant MASK   : std_logic_vector(3 downto 0) := b"10_1X";
  constant WIDE   : std_logic_vector(11 downto 0) := 12X"0FF";
  constant BASED  : integer := 16#FF# + 2#1010_1010# + 1_000;
  constant PERIOD : time := 10 ns;
  signal \bus+index\ : std_logic;
begin

  -- Move to the next state on every rising clock edge.
  state_reg : process (clk, rst_n)
  begin
    if rst_n = '0' then
      state <= IDLE;
    elsif clk'event and clk = '1' then
      state <= next_state;
    end if;
  end process state_reg;

  -- Count while toasting, and stop at the limit.
  counter : process (clk)
  begin
    if rising_edge(clk) then
      if state = TOAST then
        count <= count + 1;
      else
        count <= (others => '0');
      end if;
    end if;
  end process counter;

  -- Choose the next state from the current one.
  next_logic : process (all)
  begin
    next_state <= state;
    case state is
      when IDLE =>
        if start = '1' then
          next_state <= TOAST;
        end if;
      when TOAST =>
        if count = LIMIT then
          next_state <= POP;
        end if;
      when others =>
        next_state <= IDLE;
    end case;
  end process next_logic;

  gen_bits : for k in 0 to WIDTH - 1 generate
    ticks(k) <= count(k);
  end generate gen_bits;

  heat <= '1' when state = TOAST else '0';
  assert ticks'length = WIDTH report "Bad width: ""ticks""" severity failure;

end architecture rtl;
