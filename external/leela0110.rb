#!/usr/bin/ruby

# Wrapper for Leela 0.11.0 (not Leela Zero) <https://www.sjeng.org/leela.html>
# This Ruby script wraps leela_gtp as if it accepts lz-analyze.

# To use Leela 0.11.0 on LizGoban,
# add the following item into "preset" in your config.json.

# example of config.json:
#
# {
#     ...,
#     "preset": [
#         ...,
#         {"label": "leela 0.11.0", "engine": ["leela0110.rb"]},
#         ...
#     ],
#     ...
# }

require "open3"

$leela_in, $leela_out = *Open3.popen2e('leela_gtp -g')
$leela_in.sync = STDOUT.sync = STDERR.sync = true

######################
# leela_out

$order = 0

def c(x)
  (x.to_f * 100).to_i
end

Thread.new {
  $leela_out.each_line{|line|
    case line
    when /(\w+)\s*->\s*(\d+).*\(W:\s*([0-9.]+)%\).*\(N:\s*([0-9.]+)%\).*PV:\s*(.+)/
      _, move, visits, winrate, prior, pv = *$~
      # print ' ' if $order > 0
      print "info move #{move} visits #{visits} winrate #{c(winrate)} prior #{c(prior)} order #{$order} pv #{pv}"
      $order += 1
    when /.* feature weights loaded, .* patterns/
      STDERR.puts "GTP ready"  # mimic KataGo's start-up message for LizGoban
    else
      print "\n" if $order > 0
      $order = 0
      print line
    end
  }
}

######################
# leela_in

$analyzing = false
$analyzer = Thread.new {
  Thread.stop
  loop {
    $leela_in.puts 'time_left b 0 0'
    sleep 1
    $analyzing or Thread.stop
    $leela_in.puts 'name'
  }
}

STDIN.each{|line|
  case line
  when /^(.*)lz-analyze/
    $leela_in.puts "#{$1}name"
    $analyzing = true
    $analyzer.run
  else
    $analyzing = false
    $leela_in.print line
  end
}
