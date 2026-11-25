#!/usr/bin/env ruby
# frozen_string_literal: true

# A small bakery helper. The words class "quotes" and #{braces} in this comment stay comments.

=begin
This block comment says def and end and "quotes",
but it is all comment until the end marker.
=end

require "set"
require_relative "oven"

MAX_LOAVES = 1_000
MASK = 0xFF_FF
FLAGS = 0b1010
MODE = 0o755
RATIO = 1.5e-3
HALF = 2.5
TWO_THIRDS = 2r
SPAN = (1..10)
OPEN_SPAN = (1...5)

module Bakery
  VERSION = "1.0"

  class Loaf
    include Comparable
    attr_accessor :name, :slices
    attr_reader :heat

    @@count = 0

    def initialize(name, slices: 8, heat: :medium)
      @name = name
      @slices = slices
      @heat = heat
      @@count += 1
      $last_loaf = self
    end

    def self.count
      @@count
    end

    def empty?
      @slices.zero?
    end

    def eat!(amount = 1)
      @slices -= amount
      self
    end

    def name=(value)
      @name = value.strip
    end

    def <=>(other)
      slices <=> other.slices
    end

    def +(other)
      Loaf.new("#{name} and #{other.name}", slices: slices + other.slices)
    end

    def to_s
      "#{@name} (#{@slices} slices, #{empty? ? "gone" : "fresh"})"
    end

    def end
      "a method named end"
    end
  end
end

kind = :sourdough
quoted = :"two words"
op = :+
plain = 'single #{not code} and a \' quote'
double = "double with #{kind} and #{{ a: 1 }.map { |k, v| "#{k}=#{v}" }.join(",")} inside"
escaped = "tab\t quote\" slash\\ #{'nested'}"
words = %w[rye wheat spelt]
symbols = %i(a b c)
literal = %q{single {nested} braces}
fancy = %Q<angle <nested> #{kind}>
bare = %(parens (nested) work #{1 + 2})

text = <<~NOTE
  Today's bake: #{kind}
  The word end and "quotes" and 'quotes' are string text here.
NOTE

dashed = <<-SQL.strip
    SELECT * FROM loaves
    SQL

plain_heredoc = <<EOS
no indent, tag at the start
EOS

raw = <<~'RAW'
  nothing #{special} here
RAW

shifted = words << "rye"
bits = 1<<4
half = 10 / 2
rest = 10 % 3
words2 = [1, 2] << 3

loaf = Bakery::Loaf.new("rye", slices: 6)
puts loaf
puts loaf.empty? ? "gone" : "still here"
puts :a.to_proc.call("x") if loaf.name =~ /ry+e/i
pattern = %r{^/path/(\d+)$}x
matches = "a/b".split(/\//)
total = (1..10).reduce(0) { |sum, n| sum + n / 2 }

case loaf.slices
when 0 then puts "none"
when 1..3 then puts "few"
else puts "plenty"
end

begin
  raise ArgumentError, "bad" unless loaf.slices.positive?
rescue ArgumentError => e
  puts "caught #{e.message}"
ensure
  puts "done"
end

sorted = [3, 1, 2].sort_by { |x| -x }.map(&:to_s)
config = { name: "rye", "key" => 1, :old => 2, nested: { deep: true } }
char = ?a
count = defined?(loaf) ? loaf.slices : 0

__END__
this is data, not code: def class end "quotes"
