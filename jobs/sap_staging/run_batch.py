import sys, argparse
from post_sap_staging import build_parser, process_rows
parser = build_parser()
args = parser.parse_args(sys.argv[1:])
process_rows(args)
